import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnFailure } from "../omp/turn-failure";
import type { PlanUsage, PlanWindow } from "../shared/models";
import type { ScheduledTarget } from "../shared/scheduled";
import { AutoContinue, continueWhen, UNKNOWN_RESET_WAIT_MS } from "./auto-continue";
import { occupiedBy } from "./project-runner";
import { ScheduledFile } from "./scheduled-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-19T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const window = (label: string, resetsAt: number | null, exhausted: boolean): PlanWindow => ({ id: label, label, title: label, remaining: exhausted ? 0 : 0.5, resetsAt, exhausted });
const plan = (provider: string, name: string, account: string | null, windows: PlanWindow[]): PlanUsage => ({ provider, name, account, windows, extra: null, resetCredits: null });
const limit = (provider: string, retryAfterMs: number | null) => ({ kind: "usage-limit" as const, provider, retryAfterMs });

describe("continueWhen", () => {
	test("waits for the provider's used-up window, a minute after it resets, and names it", () => {
		const plans = [plan("anthropic", "Anthropic", "me", [window("5h", NOW + 2 * HOUR, true), window("7d", NOW + 90 * HOUR, false)]), plan("opencode-go", "Opencode Go", null, [window("monthly", NOW + HOUR, true)])];
		expect(continueWhen(limit("anthropic", 5 * HOUR), plans, NOW)).toEqual({ at: NOW + 2 * HOUR + MINUTE, reset: "Anthropic 5h", provider: "Anthropic" });
	});

	test("an account serves again only once all its used-up windows reset, and the soonest account wins", () => {
		const plans = [
			plan("anthropic", "Anthropic", "work", [window("5h", NOW + HOUR, true), window("7d", NOW + 30 * HOUR, true)]),
			plan("anthropic", "Anthropic", "home", [window("5h", NOW + 3 * HOUR, true)]),
		];
		expect(continueWhen(limit("anthropic", null), plans, NOW)).toEqual({ at: NOW + 3 * HOUR + MINUTE, reset: "Anthropic · home 5h", provider: "Anthropic" });
	});

	test("without a used-up window it waits as long as the provider's error said", () => {
		const plans = [plan("minimax-code", "Minimax Code", null, [window("4h", NOW + 3 * HOUR, false), window("7d", NOW - MINUTE, true)])];
		expect(continueWhen(limit("minimax-code", 20 * MINUTE), plans, NOW)).toEqual({ at: NOW + 21 * MINUTE, reset: "Minimax Code limit", provider: "Minimax Code" });
	});

	test("with no reset known, it tries again after a fixed wait and names no reset", () => {
		const unknownReset = [plan("cursor", "Cursor", null, [window("monthly", null, true)])];
		expect(continueWhen(limit("cursor", null), unknownReset, NOW)).toEqual({ at: NOW + UNKNOWN_RESET_WAIT_MS, reset: null, provider: "Cursor" });
		expect(continueWhen(limit("vercel-ai-gateway", null), [], NOW)).toEqual({ at: NOW + HOUR, reset: null, provider: "Vercel Ai Gateway" });
	});

	test("an account with nothing used up could serve now, so a blocked sibling's reset does not count", () => {
		const plans = [plan("anthropic", "Anthropic", "work", [window("5h", NOW + 30 * HOUR, true)]), plan("anthropic", "Anthropic", "home", [window("5h", NOW + HOUR, false)])];
		expect(continueWhen(limit("anthropic", 10 * MINUTE), plans, NOW)).toEqual({ at: NOW + 11 * MINUTE, reset: "Anthropic limit", provider: "Anthropic" });
		expect(continueWhen(limit("anthropic", null), plans, NOW)).toEqual({ at: NOW + UNKNOWN_RESET_WAIT_MS, reset: null, provider: "Anthropic" });
	});
});

/** An `AutoContinue` over `scheduled.json` in `dir`, a new directory by default; another over the same `dir` is the next server's. */
function harness(dir = mkdtempSync(join(tmpdir(), "omp-agents-continue-"))) {
	dirs.push(dir);
	const file = new ScheduledFile(join(dir, "scheduled.json"));
	const fake = { changes: 0, plans: [] as PlanUsage[], usageError: null as string | null, gate: null as Promise<void> | null, released: [] as [string, string | null][] };
	const auto = new AutoContinue({
		file,
		async plans() {
			await fake.gate;
			if (fake.usageError !== null) throw new Error(fake.usageError);
			return fake.plans;
		},
		now: () => NOW,
		onChange: () => {
			fake.changes++;
			auto.sendsChanged();
		},
		released: (sessionId, reply) => void fake.released.push([sessionId, reply]),
	});
	/** Usage reads wait until the returned function answers them. */
	const holdUsage = (): (() => void) => {
		const { promise, resolve } = Promise.withResolvers<void>();
		fake.gate = promise;
		return resolve;
	};
	const pending = () => file.value.map(send => [send.target, send.at, send.reset, send.state.phase]);
	return { dir, file, fake, auto, holdUsage, pending };
}

const anthropic = (retryAfterMs: number | null) => limit("anthropic", retryAfterMs);
const continued = (sessionId: string, provider: string, reply: string | null): ScheduledTarget => ({ kind: "continue", sessionId, provider, cause: "usage-limit", reply });

describe("AutoContinue", () => {
	test("a limit schedules one continue per session, from the usage read then, replacing the one it waited on", async () => {
		const { fake, auto, pending } = harness();
		fake.plans = [plan("anthropic", "Anthropic", null, [window("5h", NOW + 2 * HOUR, true)])];
		await auto.limited("s1", anthropic(null), null);
		fake.plans = [plan("anthropic", "Anthropic", null, [window("5h", NOW + 4 * HOUR, true)])];
		await auto.limited("s1", anthropic(null), null);
		await auto.limited("s2", limit("opencode-go", 30 * MINUTE), null);
		expect(pending()).toEqual([
			[continued("s2", "Opencode Go", null), NOW + 31 * MINUTE, "Opencode Go limit", "waiting"],
			[continued("s1", "Anthropic", null), NOW + 4 * HOUR + MINUTE, "Anthropic 5h", "waiting"],
		]);
		expect(fake.changes).toBe(3);
	});

	test("a usage read that fails still schedules from the provider's error", async () => {
		const { fake, auto, pending } = harness();
		fake.usageError = "omp usage timed out";
		await auto.limited("s1", anthropic(2 * HOUR), null);
		expect(pending()).toEqual([[continued("s1", "Anthropic", null), NOW + 2 * HOUR + MINUTE, "Anthropic limit", "waiting"]]);
	});

	test("the session is held from the limit, before the usage read answers, until its continue goes", async () => {
		const { file, fake, auto, holdUsage } = harness();
		const answer = holdUsage();
		const limited = auto.limited("s1", anthropic(HOUR), "Halfway through the migration.");
		expect(auto.held("s1")).toBe(true);
		answer();
		await limited;
		const id = file.value[0]!.id;
		file.claim(id);
		auto.sendsChanged();
		expect([auto.held("s1"), fake.released]).toEqual([true, []]);
		file.sent(id);
		auto.sendsChanged();
		expect([auto.held("s1"), fake.released]).toEqual([false, [["s1", "Halfway through the migration."]]]);
	});

	test("after a restart, a session whose continue waits in the file is still held, so its routine and project count it on its task", async () => {
		const before = harness();
		await before.auto.limited("s1", anthropic(HOUR), "Halfway through the migration.");
		before.file.flush();

		const after = harness(before.dir);
		expect([after.auto.held("s1"), occupiedBy("idle", after.auto.held("s1")), after.auto.held("s2"), after.fake.released]).toEqual([true, true, false, []]);
		after.file.apply({ op: "remove", id: after.file.value[0]!.id }, NOW);
		after.auto.sendsChanged();
		expect([after.auto.held("s1"), after.fake.released]).toEqual([false, [["s1", "Halfway through the migration."]]]);
	});

	test("a continue the page cancels releases the session, and so does one that fails, while one under way still holds", async () => {
		const { file, fake, auto } = harness();
		await auto.limited("s1", anthropic(HOUR), "one");
		await auto.limited("s2", anthropic(HOUR), "two");
		const [first, second] = file.value;
		file.apply({ op: "remove", id: first!.id }, NOW);
		file.claim(second!.id);
		auto.sendsChanged();
		expect([auto.held("s1"), auto.held("s2"), fake.released]).toEqual([false, true, [["s1", "one"]]]);
		file.failed(second!.id, "Cannot resume the session", NOW);
		auto.sendsChanged();
		expect([auto.held("s2"), fake.released, file.value.map(send => send.state.phase)]).toEqual([false, [["s1", "one"], ["s2", "two"]], ["failed"]]);
	});

	test("cancel drops that session's continue and releases it, leaving the others and plain scheduled messages", async () => {
		const { file, fake, auto, pending } = harness();
		file.apply({ op: "add", send: { id: "mine", at: NOW + HOUR, reset: null, target: { kind: "message", sessionId: "s1", text: "and then this" } } }, NOW);
		await auto.limited("s1", anthropic(HOUR), "one");
		await auto.limited("s2", anthropic(HOUR), "two");
		const changes = fake.changes;
		auto.cancel("s1");
		auto.cancel("s3");
		expect(pending()).toEqual([
			[{ kind: "message", sessionId: "s1", text: "and then this" }, NOW + HOUR, null, "waiting"],
			[continued("s2", "Anthropic", "two"), NOW + HOUR + MINUTE, "Anthropic limit", "waiting"],
		]);
		expect([fake.changes - changes, fake.released, auto.held("s2")]).toEqual([1, [["s1", "one"]], true]);
	});

	test("a cancel while the usage read runs keeps the continue from being scheduled and releases the session", async () => {
		const { fake, auto, holdUsage, pending } = harness();
		const answer = holdUsage();
		const limited = auto.limited("s1", anthropic(HOUR), null);
		auto.cancel("s1");
		answer();
		await limited;
		expect([pending(), fake.released, auto.held("s1")]).toEqual([[], [["s1", null]], false]);
	});

	test("a continue under way stays when the session hits the limit again, beside the new one, and a cancel leaves it", async () => {
		const { file, auto, pending } = harness();
		await auto.limited("s1", anthropic(HOUR), null);
		file.claim(file.value[0]!.id);
		await auto.limited("s1", anthropic(2 * HOUR), null);
		auto.cancel("s1");
		expect([pending(), auto.held("s1")]).toEqual([[[continued("s1", "Anthropic", null), NOW + HOUR + MINUTE, "Anthropic limit", "sending"]], true]);
	});

	const dropped: TurnFailure = { kind: "transient", provider: "openai-codex" };
	/** Ends a turn of `s1` on `failure`; the minutes until the continue it then waits on, or `false` when it waits on none. */
	const endTurn = (file: ScheduledFile, auto: AutoContinue, failure: TurnFailure | null): number | false => {
		const held = auto.turnEnded("s1", failure, "Halfway.");
		const waiting = file.value.find(send => send.target.kind === "continue" && send.target.sessionId === "s1" && send.state.phase === "waiting");
		return held && waiting ? (waiting.at - NOW) / MINUTE : false;
	};

	test("a transient fault holds the session for a retry, and faults in a row wait 1, 2, 4, 8, then 16 minutes; the sixth leaves it idle", () => {
		const { file, fake, auto, pending } = harness();
		expect([endTurn(file, auto, dropped), pending(), auto.held("s1")]).toEqual([
			1,
			[[{ kind: "continue", sessionId: "s1", provider: "OpenAI Codex", cause: "transient", reply: "Halfway." }, NOW + MINUTE, null, "waiting"]],
			true,
		]);
		const waits = [];
		for (let fault = 0; fault < 5; fault++) {
			const id = file.value[0]!.id;
			file.claim(id);
			file.sent(id);
			auto.sendsChanged();
			auto.turnStarted("s1");
			waits.push(endTurn(file, auto, dropped));
		}
		expect([waits, pending(), auto.held("s1"), fake.released.length]).toEqual([[2, 4, 8, 16, false], [], false, 5]);
		expect(endTurn(file, auto, dropped)).toBe(1);
	});

	test("a turn that ends cleanly or on a usage limit, an edited prompt, and End session start the retries over; a turn start does not", async () => {
		const { file, auto } = harness();
		const waits = [endTurn(file, auto, dropped)];
		auto.turnStarted("s1");
		waits.push(endTurn(file, auto, dropped));
		auto.turnStarted("s1");
		waits.push(endTurn(file, auto, null));
		auto.turnStarted("s1");
		waits.push(endTurn(file, auto, dropped));
		auto.turnStarted("s1");
		waits.push(endTurn(file, auto, dropped));
		auto.cancel("s1");
		waits.push(endTurn(file, auto, dropped));
		await auto.limited("s1", anthropic(HOUR), null);
		auto.turnStarted("s1");
		waits.push(endTurn(file, auto, dropped));
		expect(waits).toEqual([1, 2, false, 1, 2, 1, 1]);
	});
});
