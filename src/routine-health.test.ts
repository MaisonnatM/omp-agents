import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routineTurn } from "./live-session";
import { earlyRuns, type RunTurn, type TurnOf } from "./routine-health";
import type { Routine, RoutineRun } from "./routines";
import type { BotId } from "./shared/bots";
import { routineMessageText } from "./shared/routine-message";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 10 * 24 * HOUR;
const BOT = "b1" as BotId;

/** An hourly command routine with nothing overdue, as of {@link NOW}. */
const routine = (fields: Partial<Routine> = {}): Routine => ({
	id: "r1",
	botId: BOT,
	name: "Digest",
	schedules: [{ kind: "every", minutes: 60 }],
	triggers: [],
	task: { kind: "command", command: "make digest" },
	enabled: true,
	machine: null,
	createdAt: 0,
	scheduledAt: NOW - 10 * MINUTE,
	runs: [],
	...fields,
});

/** A command run claimed `hoursAgo` hours before {@link NOW} that took `ms` and exited with `code`. */
const command = (hoursAgo: number, ms = 10 * MINUTE, code = 0): RoutineRun => {
	const at = NOW - hoursAgo * HOUR;
	return { at, outcome: { kind: "command", run: { phase: "exited", code, output: "", startedAt: at, endedAt: at + ms } }, errors: [], triggeredBy: [] };
};

/** A prompt run claimed `hoursAgo` hours before {@link NOW}, sent to conversation `s1`. */
const sent = (hoursAgo: number): RoutineRun => ({ at: NOW - hoursAgo * HOUR, outcome: { kind: "sent", sessionId: "s1" }, errors: [], triggeredBy: [] });

/** Hourly runs 2 to 6 hours ago, each taking ten minutes. */
const usual = (): RoutineRun[] => [2, 3, 4, 5, 6].map(hoursAgo => command(hoursAgo));

const noTurn: TurnOf = () => null;
const turn = (fields: Partial<RunTurn> = {}): TurnOf => () => ({ replied: true, quiet: false, failed: false, ms: 5 * MINUTE, ...fields });

describe("earlyRuns", () => {
	test("routines whose runs exited 0, on time, and as long as usual find nothing", () => {
		expect(earlyRuns([routine({ runs: usual() }), routine({ id: "r2", enabled: false, scheduledAt: 0 })], NOW, noTurn)).toEqual([]);
	});

	test("a command that exited non-zero, a run with errors, and a run that failed to start each errored", () => {
		const runs = usual();
		runs[0] = command(2, 10 * MINUTE, 1);
		runs[1] = { ...command(3), errors: ["The Bot's session did not start."] };
		runs[2] = { ...command(4), outcome: { kind: "failed" } };
		expect(earlyRuns([routine({ runs })], NOW, noTurn).map(({ at, exit }) => ({ hoursAgo: (NOW - at) / HOUR, exit }))).toEqual([
			{ hoursAgo: 4, exit: "errored" },
			{ hoursAgo: 3, exit: "errored" },
			{ hoursAgo: 2, exit: "errored" },
		]);
	});

	test("a run far shorter than the routine's usual one ended early, once enough other runs show what usual is", () => {
		const short = command(2, MINUTE);
		expect(earlyRuns([routine({ runs: [short, ...usual().slice(1)] })], NOW, noTurn)).toEqual([{ botId: BOT, routineId: "r1", name: "Digest", at: short.at, exit: "short" }]);
		expect(earlyRuns([routine({ runs: [short, command(3), command(4)] })], NOW, noTurn)).toEqual([]);
	});

	test("a prompt run whose Bot's turn ended with no reply is listed, one that stayed quiet is not, and one a provider's error ended errored", () => {
		const prompt = routine({ task: { kind: "prompt", prompt: "Summarize the inbox." }, runs: [sent(2)] });
		expect(earlyRuns([prompt], NOW, turn({ replied: false }))).toEqual([{ botId: BOT, routineId: "r1", name: "Digest", at: NOW - 2 * HOUR, exit: "no-reply" }]);
		expect(earlyRuns([prompt], NOW, turn({ replied: false, quiet: true }))).toEqual([]);
		expect(earlyRuns([prompt], NOW, turn({ replied: false, failed: true })).map(({ exit }) => exit)).toEqual(["errored"]);
		expect(earlyRuns([prompt], NOW, turn())).toEqual([]);
	});

	test("a run claimed an hour or more after its slot, a run still queued an hour on, and an overdue slot with no run each missed their schedule", () => {
		const late = command(2);
		const queued: RoutineRun = { at: NOW - 3 * HOUR, outcome: { kind: "queued" }, errors: [], triggeredBy: [] };
		expect(earlyRuns([routine({ runs: [late, command(5)] })], NOW, noTurn).map(({ at, exit }) => ({ at, exit }))).toEqual([{ at: late.at, exit: "missed" }]);
		expect(earlyRuns([routine({ runs: [queued] })], NOW, noTurn).map(({ exit }) => exit)).toEqual(["missed"]);
		const overdue = routine({ scheduledAt: NOW - 3 * HOUR });
		expect(earlyRuns([overdue], NOW, noTurn)).toEqual([{ botId: BOT, routineId: "r1", name: "Digest", at: NOW - 2 * HOUR, exit: "missed" }]);
		expect(earlyRuns([{ ...overdue, enabled: false }, { ...overdue, machine: { id: "m2", name: "Laptop" } }], NOW, noTurn)).toEqual([]);
	});

	test("a triggered run claimed long after the last scheduled one did not miss its schedule", () => {
		const triggered: RoutineRun = { ...command(2), triggeredBy: [{ kind: "pull-request", title: "acme/webapp#1", detail: "Checks failed", url: null }] };
		expect(earlyRuns([routine({ runs: [triggered, command(9)] })], NOW, noTurn)).toEqual([]);
	});

	test("only runs claimed within the day before the last half hour are judged, oldest first across routines", () => {
		const fresh = command(0.25, MINUTE, 1);
		const old = command(25, MINUTE, 1);
		const other = routine({ id: "r2", name: "Prune", runs: [command(5, MINUTE, 1)] });
		expect(earlyRuns([routine({ runs: [fresh, command(2, MINUTE, 1), old] }), other], NOW, noTurn).map(({ routineId, at }) => ({ routineId, hoursAgo: (NOW - at) / HOUR }))).toEqual([
			{ routineId: "r2", hoursAgo: 5 },
			{ routineId: "r1", hoursAgo: 2 },
		]);
	});
});

describe("routineTurn", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	const at = 50;
	const prompt = (routineId: string) =>
		routineMessageText({ botId: BOT, routine: { id: routineId, name: "Digest" }, at, triggeredBy: [], sent: { kind: "prompt", prompt: "Summarize the inbox." } });
	const line = (role: string, content: unknown, timestamp: string) => JSON.stringify({ type: "message", timestamp, message: { role, content } });
	const write = (lines: string[]): string => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-health-"));
		dirs.push(dir);
		const path = join(dir, "session.jsonl");
		writeFileSync(path, `${lines.join("\n")}\n`);
		return path;
	};

	test("reads the reply, quiet, and failure of the turn after the run's prompt, up to the next prompt", () => {
		const path = write([
			line("user", prompt("r1"), "2026-05-02T09:00:00.000Z"),
			line("assistant", [{ type: "text", text: "Three new emails." }], "2026-05-02T09:04:00.000Z"),
			line("user", "Thanks, archive them.", "2026-05-02T09:10:00.000Z"),
			line("assistant", [{ type: "toolCall", name: "bash", arguments: {} }], "2026-05-02T09:11:00.000Z"),
		]);
		expect(routineTurn(path, "r1", at)).toEqual({ replied: true, quiet: false, failed: false, ms: 4 * MINUTE });
		expect(routineTurn(path, "r2", at)).toBeNull();
	});

	test("a turn that ended on tool calls alone has no reply", () => {
		const path = write([line("user", prompt("r1"), "2026-05-02T09:00:00.000Z"), line("assistant", [{ type: "toolCall", name: "bash", arguments: {} }], "2026-05-02T09:00:30.000Z")]);
		expect(routineTurn(path, "r1", at)).toEqual({ replied: false, quiet: false, failed: false, ms: 30_000 });
		expect(routineTurn(join(tmpdir(), "omp-agents-health-missing.jsonl"), "r1", at)).toBeNull();
	});
});
