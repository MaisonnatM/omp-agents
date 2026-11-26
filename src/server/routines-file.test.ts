import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { HOME } from "../paths";
import { MAX_PROMPT_LENGTH, type TriggerEvent } from "../routines";
import { ROUTINE_RECEIPT_PROMPT } from "./built-in-routines";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh `routines.json` path whose directory exists, with the Bots of the test kept beside it. */
function routinesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	mkdirSync(join(dir, "omp-agents"));
	return join(dir, "omp-agents", "routines.json");
}

/** Where the test's `bots.json` and Bot memories go, beside `path`. */
const formerBots = (path: string) => ({ file: join(path, "..", "bots.json"), dir: join(path, "..", "bots") });

const routinesAt = (path: string): RoutinesFile => new RoutinesFile(path, formerBots(path));

test("a run from before `outcome` reads its command result, and a malformed or missing one as still sending, and the routine stays", () => {
	const path = routinesPath();
	const routine = {
		id: "r1",
		name: "Prune",
		cwd: "~/code",
		schedule: { kind: "every", minutes: 60 },
		task: { kind: "command", command: "git worktree prune" },
		skill: null,
		enabled: true,
		createdAt: 1,
		done: {},
		runs: [
			{ at: 4, queued: false, started: [], errors: [], command: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
			{ at: 3, queued: false, started: [], errors: [], command: { phase: "running", startedAt: 3 } },
			{ at: 2, queued: false, started: [], errors: [], command: { phase: "exited", code: "0", output: "ok\n", startedAt: 2, endedAt: 3 } },
			{ at: 1, queued: false, started: [], errors: [] },
		],
	};
	writeFileSync(path, JSON.stringify({ routines: [routine] }));
	expect(routinesAt(path).value[0]?.runs.map(run => run.outcome)).toEqual([
		{ kind: "command", run: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
		{ kind: "command", run: { phase: "running", startedAt: 3 } },
		{ kind: "sending" },
		{ kind: "sending" },
	]);
});

test("an older file keeps its other routines, reads one schedule as a list and a run's queue as an outcome, drops a run that went into a session, and drops a pull request or project routine", () => {
	const path = routinesPath();
	const command = {
		id: "r1",
		name: "Prune",
		cwd: "~/code",
		schedule: { kind: "every" as const, minutes: 60 },
		task: { kind: "command" as const, command: "git worktree prune" },
		skill: null,
		enabled: true,
		createdAt: 1,
		done: {},
		runs: [
			{ at: 4, queue: ["single"], started: [], errors: [], command: null },
			{ at: 3, queue: [], started: [{ label: "Notes", instanceId: "i1", sessionId: "s1" }], errors: [], command: null },
			{ at: 2, outcome: { kind: "sent", sessionId: "s2" }, errors: [], triggeredBy: [] },
			{ at: 1, queue: [], started: [], errors: [], command: null },
		],
	};
	const reviews = { ...command, id: "r2", name: "Reviews", task: { kind: "pull-requests", action: "review" } };
	const updates = { ...command, id: "r3", name: "Updates", task: { kind: "project", projectId: "p1", prompt: "Check #billing-bugs." }, runs: [{ at: 1, outcome: { kind: "project", projectId: "p1" }, errors: [] }] };
	writeFileSync(path, JSON.stringify({ routines: [reviews, command, { ...reviews, name: "" }, updates] }));
	const file = routinesAt(path);
	const { schedule, done: _done, runs: _runs, cwd: _cwd, skill: _skill, ...kept } = command;
	expect(file.value).toEqual([
		{
			...kept,
			workspace: join(HOME, "code"),
			schedules: [schedule],
			triggers: [],
			machine: null,
			// Before triggers, the schedules counted from the newest run.
			scheduledAt: 4,
			runs: [
				{ at: 4, outcome: { kind: "queued" }, errors: [], triggeredBy: [] },
				{ at: 1, outcome: { kind: "sending" }, errors: [], triggeredBy: [] },
			],
		},
	]);
	expect(existsSync(`${path}.invalid`)).toBe(false);

	file.apply({ op: "enable", id: "r1", enabled: false }, 2);
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: { task: { kind: string }; schedules?: unknown; schedule?: unknown }[] };
	expect(saved.routines.map(routine => routine.task.kind)).toEqual(["command"]);
	expect(saved.routines[0]?.schedules).toEqual([{ kind: "every", minutes: 60 }]);
	expect(saved.routines[0]?.schedule).toBeUndefined();
});

test("a routine loads without its triggers, and its runs without the events, of kinds routines no longer watch, and one that ran only on those is dropped", () => {
	const path = routinesPath();
	const base = { workspace: "/work", schedules: [], task: { kind: "prompt", prompt: "Sum it up." }, enabled: true, createdAt: 1, scheduledAt: null };
	const slack: TriggerEvent = { kind: "slack", title: "Ana mentioned you in #eng", detail: "", url: null };
	const retired = { kind: "event", title: "Standup starts at 09:00", detail: "", url: null };
	const routines = [
		{ ...base, id: "r1", name: "Digest", triggers: [{ kind: "event" }, { kind: "slack" }], runs: [{ at: 2, outcome: { kind: "pending", queued: true }, errors: [], triggeredBy: [retired, slack] }] },
		{ ...base, id: "r2", name: "Reminders", triggers: [{ kind: "event" }], runs: [] },
	];
	writeFileSync(path, JSON.stringify({ routines }));
	const file = routinesAt(path);
	expect(file.value.map(({ id, triggers, runs }) => ({ id, triggers, triggeredBy: runs.map(run => run.triggeredBy) }))).toEqual([{ id: "r1", triggers: [{ kind: "slack" }], triggeredBy: [[slack]] }]);
	expect(existsSync(`${path}.invalid`)).toBe(false);
});

test("a routine from before Bots takes its own directory as its Workspace, each still doing what it did", () => {
	const path = routinesPath();
	const base = { schedules: [{ kind: "every", minutes: 60 }], skill: null, enabled: true, createdAt: 1 };
	const routines = [
		{ ...base, id: "r1", name: "Retro", cwd: "~/code", task: { kind: "prompt", prompt: "Write the daily retro.", pin: true }, skill: "retro", runs: [{ at: 2, outcome: { kind: "session", instanceId: "i1", sessionId: "s1" }, errors: [] }] },
		{ ...base, id: "r2", name: "Prune", cwd: "~/it's", task: { kind: "command", command: "git worktree prune" }, runs: [] },
		{ ...base, id: "r4", name: "Notes", task: { kind: "prompt", prompt: "Tidy the notes." }, runs: [] },
	];
	writeFileSync(path, JSON.stringify({ routines }));
	const file = routinesAt(path);
	expect(file.value.map(({ id, workspace, task, runs }) => ({ id, workspace, task, runs: runs.length }))).toEqual([
		{ id: "r1", workspace: join(HOME, "code"), task: { kind: "prompt", prompt: "/skill:retro Write the daily retro." }, runs: 0 },
		{ id: "r2", workspace: join(HOME, "it's"), task: { kind: "command", command: "git worktree prune" }, runs: 0 },
		{ id: "r4", workspace: HOME, task: { kind: "prompt", prompt: "Tidy the notes." }, runs: 0 },
	]);

	file.migrate();
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: Record<string, unknown>[] };
	expect(saved.routines.map(routine => ["cwd" in routine, "skill" in routine])).toEqual(routines.map(() => [false, false]));
	expect(routinesAt(path).value).toEqual(file.value);
});

describe("a file from when routines belonged to Bots", () => {
	/** Writes `bots.json` with Bot Scout, in ~/webapp, and its memory, beside `path`, and routines of Scout and of a Bot that is gone. */
	function writeBotsFile(path: string, memory = "Ana owns deploys.\n"): void {
		const { file, dir } = formerBots(path);
		const scout = { id: "scout", name: "Scout", cwd: "~/webapp", job: "Watch the deploys.", model: "anthropic/claude-opus", skill: "triage" };
		writeFileSync(file, JSON.stringify({ bots: [scout, { id: "plain", name: "Plain", cwd: "/work/plain", job: "" }] }));
		mkdirSync(join(dir, "scout"), { recursive: true });
		writeFileSync(join(dir, "scout", "memory.md"), memory);
		const base = { schedules: [{ kind: "every", minutes: 60 }], triggers: [], enabled: true, createdAt: 1, scheduledAt: null };
		const routines = [
			{ ...base, id: "r1", botId: "scout", name: "Deploys", task: { kind: "prompt", prompt: "Check the deploys." }, freshConversation: true, runs: [{ at: 2, outcome: { kind: "sent", sessionId: "s1" }, errors: [], triggeredBy: [] }] },
			{ ...base, id: "r2", botId: "scout", name: "Prune", task: { kind: "command", command: "git worktree prune", post: "failures" }, runs: [] },
			{ ...base, id: "r3", botId: "gone", name: "Orphan", task: { kind: "prompt", prompt: "Hi." }, runs: [] },
			{ ...base, id: "r4", botId: "plain", name: "Plain", task: { kind: "prompt", prompt: "Hi." }, runs: [] },
		];
		writeFileSync(path, JSON.stringify({ routines }));
	}

	test("each routine moves to its Bot's Workspace, with its Bot's model and skill, and its Bot's job and memory after its prompt; one whose Bot is gone is dropped", () => {
		const path = routinesPath();
		writeBotsFile(path);
		const file = routinesAt(path);
		const launch = { model: { provider: "anthropic", id: "claude-opus" }, thinking: null, skill: "triage" };
		const folded = "## Job\nWatch the deploys.\n\n## Memory\nAna owns deploys.";
		expect(file.value.map(({ id, workspace, launch, task, runs }) => ({ id, workspace, launch, task, runs: runs.length }))).toEqual([
			{ id: "r1", workspace: join(HOME, "webapp"), launch, task: { kind: "prompt", prompt: `Check the deploys.\n\n${folded}` }, runs: 0 },
			{ id: "r2", workspace: join(HOME, "webapp"), launch, task: { kind: "command", command: "git worktree prune", post: "failures", prompt: folded }, runs: 0 },
			{ id: "r4", workspace: "/work/plain", launch: undefined, task: { kind: "prompt", prompt: "Hi." }, runs: 0 },
		]);
	});

	test("the owner saves the moved file and renames bots.json, and a second migration changes nothing", () => {
		const path = routinesPath();
		writeBotsFile(path);
		const { file: botsJson } = formerBots(path);
		const file = routinesAt(path);
		file.migrate();
		flushJsonFiles();
		expect([existsSync(botsJson), existsSync(`${botsJson}.migrated`)]).toEqual([false, true]);
		const saved = readFileSync(path, "utf8");
		expect(saved).not.toContain("botId");

		const next = routinesAt(path);
		next.migrate();
		flushJsonFiles();
		expect([next.value, readFileSync(path, "utf8")]).toEqual([file.value, saved]);
	});

	test("the migration keeps the file it moved from, and a second bots.json.migrated does not replace the first", () => {
		const path = routinesPath();
		writeBotsFile(path);
		const before = readFileSync(path, "utf8");
		const { file: botsJson } = formerBots(path);
		writeFileSync(`${botsJson}.migrated`, "earlier");
		routinesAt(path).migrate();
		flushJsonFiles();
		expect(readFileSync(`${path}.before-board`, "utf8")).toBe(before);
		expect(readFileSync(`${botsJson}.migrated`, "utf8")).toBe("earlier");
		expect(readdirSync(join(path, "..")).filter(name => name.startsWith("bots.json.migrated-"))).toHaveLength(1);
	});

	test("a routine that moves but does not parse keeps routines.json and bots.json as they are", () => {
		const path = routinesPath();
		writeBotsFile(path);
		const { routines } = JSON.parse(readFileSync(path, "utf8")) as { routines: Record<string, unknown>[] };
		writeFileSync(path, JSON.stringify({ routines: [...routines, { ...routines[0], id: "r5", task: { kind: "unknown" } }] }));
		const before = readFileSync(path, "utf8");
		const { file: botsJson } = formerBots(path);
		routinesAt(path).migrate();
		flushJsonFiles();
		expect([readFileSync(path, "utf8"), existsSync(botsJson), readFileSync(`${path}.before-board`, "utf8")]).toEqual([before, true, before]);
	});

	test("a built-in routine keeps the task the dashboard ships, with no job or memory folded in", () => {
		const path = routinesPath();
		writeBotsFile(path);
		const { routines } = JSON.parse(readFileSync(path, "utf8")) as { routines: Record<string, unknown>[] };
		writeFileSync(path, JSON.stringify({ routines: [{ ...routines[0], id: "routine-receipt-weekly", task: { kind: "prompt", prompt: "An old receipt with stay_quiet." } }] }));
		expect(routinesAt(path).value.map(({ id, workspace, task }) => ({ id, workspace, task }))).toEqual([
			{ id: "routine-receipt-weekly", workspace: join(HOME, "webapp"), task: { kind: "prompt", prompt: ROUTINE_RECEIPT_PROMPT } },
		]);
	});

	test("a prompt folded past the limit is cut to it", () => {
		const path = routinesPath();
		writeBotsFile(path, "x".repeat(MAX_PROMPT_LENGTH));
		const task = routinesAt(path).value[0]?.task;
		expect(task?.kind === "prompt" && task.prompt.length).toBe(MAX_PROMPT_LENGTH);
	});
});

test("a triggered run keeps the schedules' clock, which a scheduled run moves, and both survive a reload", () => {
	const path = routinesPath();
	const file = routinesAt(path);
	file.apply({ op: "save", routine: { id: "r1", workspace: "/work", name: "Triage", schedules: [{ kind: "every", minutes: 60 }], triggers: [{ kind: "slack" }], task: { kind: "prompt", prompt: "Hi." }, enabled: true } }, 1);
	const dm: TriggerEvent = { kind: "slack", title: "Bo wrote to you", detail: "Lunch?", url: null };
	file.claim("r1", 10, []);
	file.claim("r1", 20, [dm]);
	expect(file.value[0]).toMatchObject({ scheduledAt: 10, runs: [{ at: 20, triggeredBy: [dm] }, { at: 10, triggeredBy: [] }] });
	file.flush();
	expect(routinesAt(path).value).toEqual(file.value);
});

test("a queued, sending, or failed run saves in the shape older servers read, a posted one names its Board task, and each reads back the same", () => {
	const path = routinesPath();
	const file = routinesAt(path);
	file.apply({ op: "save", routine: { id: "r1", workspace: "/work", name: "Notes", schedules: [{ kind: "every", minutes: 60 }], triggers: [], task: { kind: "prompt", prompt: "Hi." }, enabled: true } }, 1);
	for (const at of [10, 20, 30, 40]) file.claim("r1", at, []);
	file.sending("r1", 30);
	file.sending("r1", 20);
	file.sending("r1", 10);
	file.failed("r1", 20, "The Board is full.");
	file.posted("r1", 10, 7);
	file.usage("r1", 10, { tokens: 1200, cost: 0.03 });
	expect(file.value[0]?.runs.map(run => run.outcome)).toEqual([{ kind: "queued" }, { kind: "sending" }, { kind: "failed" }, { kind: "posted", task: 7 }]);
	file.flush();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: { runs: { outcome: unknown }[] }[] };
	expect(saved.routines[0]?.runs.map(run => run.outcome)).toEqual([
		{ kind: "pending", queued: true },
		{ kind: "pending", queued: false },
		{ kind: "pending", queued: false },
		{ kind: "posted", task: 7 },
	]);
	expect(routinesAt(path).value).toEqual(file.value);
});

test("a file that is not a list of routines moves aside", () => {
	const path = routinesPath();
	writeFileSync(path, JSON.stringify({ routines: [{ id: "r1", workspace: "/work/webapp" }] }));
	expect(routinesAt(path).value).toEqual([]);
	expect(existsSync(path)).toBe(false);
	expect(existsSync(`${path}.invalid`)).toBe(true);
});
