import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ScheduledTarget } from "../shared/scheduled";
import { newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import { ScheduledFile } from "./scheduled-file";
import { ScheduledRunner, STOPPED_WHILE_SENDING } from "./scheduled-runner";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-10-12T12:00:00Z");
const MINUTE = 60_000;

function scheduledPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-scheduled-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "scheduled.json");
}

const message = (sessionId: string, text: string): ScheduledTarget => ({ kind: "message", sessionId, text });

/** A runner over a fresh file with a fake clock, starter, and live sessions keyed by session id. */
function harness() {
	const file = new ScheduledFile(scheduledPath());
	const fake = {
		now: T0,
		/** Live sessions by session id, with what each received. */
		live: new Map<string, string[]>(),
		instances: new Map<string, string>(),
		requests: [] as StartRequest[],
		failWith: null as string | null,
		changes: 0,
	};
	const recipient = (sessionId: string) => {
		const received = fake.live.get(sessionId);
		return received ? { prompt: async (_agentId: string | null, text: string) => void received.push(text) } : null;
	};
	const runner = new ScheduledRunner({
		file,
		async start(request: StartRequest): Promise<StartResult> {
			fake.requests.push(request);
			if (fake.failWith !== null) return { ok: false, error: fake.failWith };
			const instanceId = `i${fake.requests.length}`;
			const sessionId = request.kind === "resume" ? request.sessionId : `new-${instanceId}`;
			fake.live.set(sessionId, []);
			fake.instances.set(instanceId, sessionId);
			return { ok: true, instanceId, cwd: "/work/webapp", prompt: null };
		},
		bySessionId: recipient,
		session: instanceId => recipient(fake.instances.get(instanceId) ?? ""),
		now: () => fake.now,
		onChange: () => void fake.changes++,
	});
	const add = (id: string, at: number, target: ScheduledTarget) => file.apply({ op: "add", send: { id, at, reset: null, target } }, T0);
	return { file, fake, runner, add };
}

describe("ScheduledRunner", () => {
	test("a due message reaches its live session and leaves the list; a later one waits", async () => {
		const { file, fake, runner, add } = harness();
		fake.live.set("s1", []);
		add("due", T0 + MINUTE, message("s1", "continue"));
		add("later", T0 + 5 * MINUTE, message("s1", "and then this"));
		fake.now = T0 + 2 * MINUTE;
		await runner.tick();
		expect(fake.live.get("s1")).toEqual(["continue"]);
		expect(fake.requests).toEqual([]);
		expect(file.value.map(send => [send.id, send.state.phase])).toEqual([["later", "waiting"]]);
	});

	test("a message to a session that is not running resumes it, then reaches the resumed session", async () => {
		const { file, fake, runner, add } = harness();
		add("m", T0, message("s-past", "the plan reset, carry on"));
		await runner.tick();
		expect(fake.requests).toEqual([{ kind: "resume", sessionId: "s-past" }]);
		expect(fake.live.get("s-past")).toEqual(["the plan reset, carry on"]);
		expect(file.value).toEqual([]);
	});

	test("a start that fails stays with its error until Send now tries again", async () => {
		const { file, fake, runner, add } = harness();
		const request = newSessionRequest("/work/webapp", "Pick up the migration.");
		add("s", T0, { kind: "start", request });
		fake.failWith = "Out of credits.";
		await runner.tick();
		expect(file.value.map(send => send.state)).toEqual([{ phase: "failed", error: "Out of credits.", at: T0 }]);

		await runner.tick();
		expect(fake.requests).toHaveLength(1);

		fake.failWith = null;
		await runner.sendNow("s");
		expect(fake.requests).toEqual([request, request]);
		expect(file.value).toEqual([]);
	});

	test("two sends of the same message at once deliver it once", async () => {
		const { fake, runner, add } = harness();
		fake.live.set("s1", []);
		add("m", T0 + MINUTE, message("s1", "once"));
		await Promise.all([runner.sendNow("m"), runner.sendNow("m"), runner.tick()]);
		expect(fake.live.get("s1")).toEqual(["once"]);
	});

	test("a take refused while the send is under way leaves it to go once", async () => {
		const { file, fake, runner, add } = harness();
		fake.live.set("s1", []);
		add("m", T0, message("s1", "already going"));
		const sending = runner.sendNow("m");
		expect(() => file.apply({ op: "take", id: "m" }, T0)).toThrow("It is already sending.");
		await sending;
		expect(fake.live.get("s1")).toEqual(["already going"]);
		expect(file.value).toEqual([]);
	});

	test("a send a stopped server left sending fails instead of going again", async () => {
		const { file, fake, runner, add } = harness();
		fake.live.set("s1", []);
		add("m", T0, message("s1", "maybe sent"));
		file.claim("m");
		fake.now = T0 + MINUTE;
		runner.recover();
		await runner.tick();
		expect(fake.live.get("s1")).toEqual([]);
		expect(file.value.map(send => send.state)).toEqual([{ phase: "failed", error: STOPPED_WHILE_SENDING, at: T0 + MINUTE }]);
	});
});

describe("ScheduledFile", () => {
	test("a send another server added and its state survive a reload on this one", () => {
		const path = scheduledPath();
		const mine = new ScheduledFile(path);
		const theirs = new ScheduledFile(path);
		theirs.apply({ op: "add", send: { id: "a", at: T0, reset: "Anthropic 5h", target: message("s1", "go") } }, T0);
		theirs.failed("a", "Cannot resume the session: gone", T0);
		mine.apply({ op: "add", send: { id: "b", at: T0 - MINUTE, reset: null, target: message("s2", "first") } }, T0);
		expect(new ScheduledFile(path).value).toEqual([
			{ id: "b", at: T0 - MINUTE, reset: null, target: message("s2", "first"), createdAt: T0, state: { phase: "waiting" } },
			{ id: "a", at: T0, reset: "Anthropic 5h", target: message("s1", "go"), createdAt: T0, state: { phase: "failed", error: "Cannot resume the session: gone", at: T0 } },
		]);
	});

	test("a send under way cannot be removed, and a removed one is gone", () => {
		const file = new ScheduledFile(scheduledPath());
		file.apply({ op: "add", send: { id: "a", at: T0, reset: null, target: message("s1", "go") } }, T0);
		file.apply({ op: "add", send: { id: "b", at: T0, reset: null, target: message("s1", "too") } }, T0);
		file.claim("a");
		expect(file.apply({ op: "remove", id: "a" }, T0)).toBe(false);
		expect(file.apply({ op: "remove", id: "b" }, T0)).toBe(true);
		expect(file.value.map(send => send.id)).toEqual(["a"]);
	});

	test("a kept start reads back as a new session's start, and a file holding a send the page could not add moves aside", () => {
		const path = scheduledPath();
		const request = newSessionRequest("/work/app", "Review the plan", { skill: "review", todoId: "t1" });
		const start: ScheduledTarget = { kind: "start", request };
		new ScheduledFile(path).apply({ op: "add", send: { id: "a", at: T0, reset: null, target: start } }, T0);
		expect(new ScheduledFile(path).value).toEqual([{ id: "a", at: T0, reset: null, target: start, createdAt: T0, state: { phase: "waiting" } }]);

		const withImage = { ...request, images: [{ data: "aGk=", mimeType: "image/png" }] };
		writeFileSync(path, JSON.stringify({ sends: [{ id: "b", at: T0, reset: null, target: { kind: "start", request: withImage }, createdAt: T0, state: { phase: "waiting" } }] }));
		expect(new ScheduledFile(path).value).toEqual([]);
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});

	test("a send at a time that is not a whole millisecond moves the file aside", () => {
		const path = scheduledPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ sends: [{ id: "a", at: T0 + 0.5, reset: null, target: message("s1", "go"), createdAt: T0, state: { phase: "waiting" } }] }));
		expect(new ScheduledFile(path).value).toEqual([]);
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});

	test("a take writes a waiting or failed send off at once, and refuses one under way or gone, which stays as it was", () => {
		const path = scheduledPath();
		const file = new ScheduledFile(path);
		const onDisk = (): unknown => JSON.parse(readFileSync(path, "utf8"));
		// Each send is named for the phase it ends up in.
		const stored = (...ids: string[]) => ({ sends: ids.map(id => ({ id, state: { phase: id } })) });
		for (const id of ["waiting", "failed", "sending"]) file.apply({ op: "add", send: { id, at: T0, reset: null, target: message("s1", id) } }, T0);
		file.failed("failed", "Cannot resume the session: gone", T0);
		file.claim("sending");
		expect(file.apply({ op: "take", id: "waiting" }, T0)).toBe(true);
		expect(onDisk()).toMatchObject(stored("failed", "sending"));

		expect(() => file.apply({ op: "take", id: "sending" }, T0)).toThrow("It is already sending.");
		expect(() => file.apply({ op: "take", id: "waiting" }, T0)).toThrow("It is no longer scheduled.");
		expect(onDisk()).toMatchObject(stored("failed", "sending"));

		expect(file.apply({ op: "take", id: "failed" }, T0)).toBe(true);
		expect(onDisk()).toMatchObject(stored("sending"));
	});
});
