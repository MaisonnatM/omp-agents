import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BotId } from "../shared/bots";
import { applyPins } from "../shared/pins";
import { type HostStatus, newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import type { RoutineTask } from "../routines";
import { occupiedBy } from "./auto-continue";
import { RoutineRunner, SESSION_START_DEADLINE_MS } from "./routine-runner";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-05T08:00:00Z");

function routinesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "routines.json");
}

const everyHour = { kind: "every" as const, minutes: 60 };

function fileWith(path: string, task: RoutineTask = { kind: "prompt", prompt: "Summarize yesterday's commits.", pin: false }): RoutinesFile {
	const file = new RoutinesFile(path);
	file.apply({ op: "save", routine: { id: "r1", name: "Notes", cwd: "/work/webapp", schedules: [everyHour], task, skill: task.kind === "prompt" ? "ship" : null, enabled: true } }, T0);
	return file;
}

/** Adds hourly prompt routines `r2` onward, so several can be due together. */
function addPrompts(file: RoutinesFile, count: number): void {
	for (let index = 2; index <= count; index++) {
		file.apply(
			{
				op: "save",
				routine: { id: `r${index}`, name: `Notes ${index}`, cwd: "/work/webapp", schedules: [everyHour], task: { kind: "prompt", prompt: `Prompt ${index}`, pin: false }, skill: null, enabled: true },
			},
			T0,
		);
	}
}

/** A command the runner ran, which the test ends by hand. */
interface FakeExec {
	command: string;
	cwd: string;
	end: (result: { exitCode: number | null; output: string }) => void;
	fail: (err: Error) => void;
}

/** A session the fake starter started; `held`: a usage limit stopped its turn, and its continue waits. */
interface FakeSession {
	status: HostStatus;
	held: boolean;
	ended: boolean;
}

/** A runner over `file` with a fake clock, starter, sessions, commands, and pins; `sessions` are the ones a previous server left running. */
function harness(file: RoutinesFile, sessions = new Map<string, FakeSession>()) {
	const fake = {
		now: T0 + HOUR,
		requests: [] as StartRequest[],
		/** The error the next starts answer with, or `null` to start. */
		failWith: null as string | null,
		sessions,
		execs: [] as FakeExec[],
		pins: [] as string[],
		/** Each pin change and session end, in order. */
		log: [] as string[],
		/** Each message a Bot was sent, as `<bot>: <text>`; a Bot not named in `bots` is gone. */
		messages: [] as string[],
		bots: new Map<string, string>(),
	};
	const runner = new RoutineRunner({
		file,
		async start(request: StartRequest): Promise<StartResult> {
			fake.requests.push(request);
			if (fake.failWith !== null) return { ok: false, error: fake.failWith };
			const instanceId = `i${sessions.size + 1}`;
			sessions.set(instanceId, { status: "unknown", held: false, ended: false });
			return { ok: true, instanceId, cwd: "/work/webapp", prompt: null };
		},
		session(instanceId) {
			const session = sessions.get(instanceId);
			if (!session || session.ended) return null;
			return {
				status: session.status,
				occupied: occupiedBy(session.status, session.held),
				sessionId: `s-${instanceId}`,
				end: async () => {
					session.ended = true;
					fake.log.push(`end s-${instanceId}`);
				},
			};
		},
		now: () => fake.now,
		exec(command, cwd) {
			const { promise, resolve, reject } = Promise.withResolvers<{ exitCode: number | null; output: string }>();
			fake.execs.push({ command, cwd, end: resolve, fail: reject });
			return promise;
		},
		onChange: () => {},
		changePins(change) {
			fake.pins = applyPins(fake.pins, change);
			fake.log.push(`${change.op} ${change.sessionIds.join(",")}`);
		},
		async messageBot(botId: BotId, text: string): Promise<string> {
			const sessionId = fake.bots.get(botId);
			if (!sessionId) throw new Error("This Bot is gone.");
			fake.messages.push(`${botId}: ${text}`);
			return sessionId;
		},
	});
	return { runner, fake };
}

describe("RoutineRunner", () => {
	test("a queued run survives a restart, and the next server starts it without claiming again", async () => {
		const path = routinesPath();
		const firstFile = fileWith(path);
		addPrompts(firstFile, 4);
		const first = harness(firstFile);
		await first.runner.tick();
		expect(first.fake.requests).toHaveLength(3);
		expect(firstFile.value[3]?.runs[0]?.outcome).toEqual({ kind: "pending", queued: true });

		const file = new RoutinesFile(path);
		const second = harness(file);
		await second.runner.tick();
		expect(second.fake.requests).toHaveLength(1);
		expect(file.value.map(routine => routine.runs[0]?.outcome.kind)).toEqual(["session", "session", "session", "session"]);
		expect(file.value.map(routine => routine.runs.length)).toEqual([1, 1, 1, 1]);
	});

	test("no more than three routine sessions run at once, and a freed slot takes the next routine", async () => {
		const file = fileWith(routinesPath());
		addPrompts(file, 4);
		const { runner, fake } = harness(file);
		await runner.tick();
		for (const session of fake.sessions.values()) session.status = "working";
		await runner.tick();
		expect(fake.requests).toHaveLength(3);
		fake.sessions.get("i1")!.status = "idle";
		await runner.tick();
		await runner.tick();
		expect(fake.sessions.get("i1")?.ended).toBe(true);
		expect(fake.requests).toHaveLength(4);
	});

	test("each start takes the prompt with the unattended suffix, in the routine's workspace and skill", async () => {
		const { runner, fake } = harness(fileWith(routinesPath()));
		await runner.tick();
		expect(fake.requests).toEqual([
			newSessionRequest(
				"/work/webapp",
				"Summarize yesterday's commits. This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.",
				{ skill: "ship" },
			),
		]);
	});

	test("a start that fails records the error, and the next run tries again", async () => {
		const file = fileWith(routinesPath());
		const { runner, fake } = harness(file);
		fake.failWith = "omp is not installed";
		await runner.tick();
		expect(file.value[0]?.runs[0]?.errors).toEqual(["Notes: omp is not installed"]);
		expect(file.value[0]?.runs[0]?.outcome).toEqual({ kind: "pending", queued: false });

		fake.failWith = null;
		fake.now += HOUR;
		await runner.tick();
		expect(fake.requests).toHaveLength(2);
		expect(file.value[0]?.runs[0]?.outcome).toEqual({ kind: "session", instanceId: "i1", sessionId: "s-i1" });
	});

	test("a session that worked and went idle ends, and one idle before it ever worked keeps running", async () => {
		const file = fileWith(routinesPath());
		addPrompts(file, 2);
		const { runner, fake } = harness(file);
		await runner.tick();
		fake.sessions.get("i1")!.status = "working";
		await runner.tick();
		fake.sessions.get("i1")!.status = "idle";
		fake.sessions.get("i2")!.status = "idle";
		await runner.tick();
		expect(fake.sessions.get("i1")?.ended).toBe(true);
		expect(fake.sessions.get("i2")?.ended).toBe(false);
	});

	test("a session that is still idle when the start deadline passes fails its run, ends, and frees its slot", async () => {
		const file = fileWith(routinesPath());
		addPrompts(file, 4);
		const { runner, fake } = harness(file);
		await runner.tick();
		expect(fake.requests).toHaveLength(3);
		for (const session of fake.sessions.values()) session.status = "idle";

		fake.now += SESSION_START_DEADLINE_MS - 1;
		await runner.tick();
		expect([...fake.sessions.values()].map(session => session.ended)).toEqual([false, false, false]);

		// One of them did start its turn in time.
		fake.sessions.get("i2")!.status = "working";
		fake.now += 1;
		await runner.tick();
		expect([...fake.sessions.values()].map(session => session.ended)).toEqual([true, false, true]);
		expect(file.value[0]?.runs[0]?.errors).toEqual(["The session never started its turn within 10 minutes, so it was ended."]);
		expect(file.value[1]?.runs[0]?.errors).toEqual([]);
		expect(fake.requests).toHaveLength(3);

		// The freed slots take the routine that waited.
		await runner.tick();
		expect(fake.requests).toHaveLength(4);
	});

	test("a session ends as soon as its row reports the turn over, without waiting for a tick", async () => {
		const { runner, fake } = harness(fileWith(routinesPath()));
		await runner.tick();
		fake.sessions.get("i1")!.status = "working";
		runner.observe("i1");
		fake.sessions.get("i1")!.status = "idle";
		runner.observe("i1");
		await Promise.resolve();
		expect(fake.sessions.get("i1")?.ended).toBe(true);
	});

	test("a session a usage limit holds reads idle but keeps its slot, and ends once its hold ends", async () => {
		const { runner, fake } = harness(fileWith(routinesPath()));
		await runner.tick();
		const session = fake.sessions.get("i1")!;
		session.status = "working";
		runner.observe("i1");
		session.status = "idle";
		session.held = true;
		runner.observe("i1");
		await runner.tick();
		fake.now += SESSION_START_DEADLINE_MS;
		await runner.tick();
		expect([session.ended, fake.log]).toEqual([false, []]);
		session.held = false;
		runner.observe("i1");
		await Promise.resolve();
		expect([session.ended, fake.log]).toEqual([true, ["end s-i1"]]);
	});

	test("a prompt routine starts no second session while its last one still runs", async () => {
		const file = fileWith(routinesPath(), { kind: "prompt", prompt: "Summarize yesterday's commits.", pin: false });
		const { runner, fake } = harness(file);
		await runner.tick();
		fake.sessions.get("i1")!.status = "working";
		fake.now += HOUR;
		await runner.tick();
		expect(fake.requests.length).toBe(1);
		expect(file.value[0]?.runs.map(run => [run.outcome.kind, run.errors])).toEqual([
			["pending", ["The last run's session is still running."]],
			["session", []],
		]);
	});

	test("a routine that pins its session pins each finished one before it ends, in place of its earlier one, and leaves other pins alone", async () => {
		const file = fileWith(routinesPath(), { kind: "prompt", prompt: "Write the daily retro.", pin: true });
		const { runner, fake } = harness(file);
		fake.pins = ["s-mine"];
		await runner.tick();
		fake.sessions.get("i1")!.status = "working";
		await runner.tick();
		fake.sessions.get("i1")!.status = "idle";
		await runner.tick();
		expect(fake.pins).toEqual(["s-mine", "s-i1"]);

		fake.now += HOUR;
		await runner.tick();
		fake.sessions.get("i2")!.status = "working";
		await runner.tick();
		fake.sessions.get("i2")!.status = "idle";
		await runner.tick();
		expect(fake.pins).toEqual(["s-mine", "s-i2"]);
		expect(fake.log).toEqual(["pin s-i1", "end s-i1", "unpin s-i1", "pin s-i2", "end s-i2"]);
	});

	test("a routine that does not pin, and a session ended at the start deadline, pin nothing", async () => {
		const file = fileWith(routinesPath());
		file.apply({ op: "save", routine: { id: "r2", name: "Retro", cwd: "/work/webapp", schedules: [everyHour], task: { kind: "prompt", prompt: "Write the daily retro.", pin: true }, skill: null, enabled: true } }, T0);
		const { runner, fake } = harness(file);
		await runner.tick();
		fake.sessions.get("i1")!.status = "working";
		await runner.tick();
		fake.sessions.get("i1")!.status = "idle";
		fake.sessions.get("i2")!.status = "idle";
		fake.now += SESSION_START_DEADLINE_MS;
		await runner.tick();
		expect(fake.log).toEqual(["end s-i1", "end s-i2"]);
		expect(fake.pins).toEqual([]);
	});

	test("a session that survived a restart stays its routine's: it holds its slot, and ends pinned once its turn is over, while one that died frees its slot", async () => {
		const path = routinesPath();
		const before = fileWith(path, { kind: "prompt", prompt: "Write the daily retro.", pin: true });
		addPrompts(before, 5);
		const first = harness(before);
		await first.runner.tick();
		for (const session of first.fake.sessions.values()) session.status = "working";
		await first.runner.tick();
		// i3's omp exited while no server watched.
		first.fake.sessions.get("i3")!.ended = true;

		const file = new RoutinesFile(path);
		const after = harness(file, first.fake.sessions);
		after.runner.recover();
		await after.runner.tick();
		expect(file.value.map(routine => routine.runs[0]?.outcome)).toEqual([
			{ kind: "session", instanceId: "i1", sessionId: "s-i1" },
			{ kind: "session", instanceId: "i2", sessionId: "s-i2" },
			{ kind: "session", instanceId: "i3", sessionId: "s-i3" },
			{ kind: "session", instanceId: "i4", sessionId: "s-i4" },
			{ kind: "pending", queued: true },
		]);
		expect(file.value.map(routine => routine.runs[0]?.errors)).toEqual([[], [], [], [], []]);

		first.fake.sessions.get("i1")!.status = "idle";
		after.runner.observe("i1");
		await Promise.resolve();
		expect([after.fake.log, after.fake.pins]).toEqual([["pin s-i1", "end s-i1"], ["s-i1"]]);
		await after.runner.tick();
		expect(file.value[4]?.runs[0]?.outcome).toEqual({ kind: "session", instanceId: "i5", sessionId: "s-i5" });
	});

	test("a session whose turn ended while no server watched ends at the first tick after the restart", async () => {
		const path = routinesPath();
		const first = harness(fileWith(path));
		await first.runner.tick();
		first.fake.sessions.get("i1")!.status = "working";
		await first.runner.tick();
		first.fake.sessions.get("i1")!.status = "idle";

		const after = harness(new RoutinesFile(path), first.fake.sessions);
		after.runner.recover();
		await after.runner.tick();
		expect(after.fake.log).toEqual(["end s-i1"]);
	});

	describe("a command routine", () => {
		const command = { kind: "command", command: "git worktree prune" } as const;
		/** Lets the runner see a command that the test just ended. */
		const settled = () => new Promise<void>(resolve => setImmediate(resolve));

		test("runs its command once in its workspace, returns from the tick while it runs, and saves how it ended", async () => {
			const file = fileWith(routinesPath(), command);
			const { runner, fake } = harness(file);
			await runner.tick();
			expect(fake.execs.map(({ command, cwd }) => ({ command, cwd }))).toEqual([{ command: "git worktree prune", cwd: "/work/webapp" }]);
			expect(file.value[0]?.runs[0]).toEqual({ at: T0 + HOUR, outcome: { kind: "command", run: { phase: "running", startedAt: T0 + HOUR } }, errors: [] });

			fake.now += 4000;
			fake.execs[0]!.end({ exitCode: 0, output: "Removing worktrees/old\n" });
			await settled();
			expect(file.value[0]?.runs[0]).toEqual({
				at: T0 + HOUR,
				outcome: { kind: "command", run: { phase: "exited", code: 0, output: "Removing worktrees/old\n", startedAt: T0 + HOUR, endedAt: T0 + HOUR + 4000 } },
				errors: [],
			});
			expect(fake.requests).toEqual([]);
		});

		test("runs no second command while its last one runs, and a failure or a stop goes to the run's errors", async () => {
			const file = fileWith(routinesPath(), command);
			const { runner, fake } = harness(file);
			await runner.tick();
			fake.now += HOUR;
			await runner.tick();
			expect(fake.execs.length).toBe(1);
			expect(file.value[0]?.runs.map(run => run.errors)).toEqual([["The last run's command is still running."], []]);

			fake.execs[0]!.end({ exitCode: 3, output: "fatal: not a git repository\n" });
			await settled();
			expect(file.value[0]?.runs[1]).toMatchObject({ errors: ["Exited with code 3."], outcome: { kind: "command", run: { phase: "exited", code: 3, output: "fatal: not a git repository\n" } } });

			fake.now += HOUR;
			await runner.tick();
			fake.execs[1]!.end({ exitCode: null, output: "" });
			await settled();
			expect(file.value[0]?.runs[0]).toMatchObject({ errors: ["Stopped after 10 minutes."], outcome: { kind: "command", run: { phase: "stopped", reason: "time-limit" } } });
		});

		test("a command that cannot start saves why as its failure and its error", async () => {
			const file = fileWith(routinesPath(), command);
			const { runner, fake } = harness(file);
			await runner.tick();
			fake.execs[0]!.fail(new Error("/work/webapp is not a directory."));
			await settled();
			expect(file.value[0]?.runs[0]).toMatchObject({
				errors: ["/work/webapp is not a directory."],
				outcome: { kind: "command", run: { phase: "failed", error: "/work/webapp is not a directory." } },
			});
		});

		test("runs while every session slot is busy", async () => {
			const file = fileWith(routinesPath());
			addPrompts(file, 3);
			file.apply({ op: "save", routine: { id: "r4", name: "Prune", cwd: "/work/other", schedules: [everyHour], task: command, skill: null, enabled: true } }, T0);
			const { runner, fake } = harness(file);
			await runner.tick();
			expect(fake.requests).toHaveLength(3);
			expect(fake.execs.map(exec => exec.cwd)).toEqual(["/work/other"]);
		});

		test("the next server runs no command that a stopped one left running, and that run says why", async () => {
			const path = routinesPath();
			const first = harness(fileWith(path, command));
			await first.runner.tick();

			const file = new RoutinesFile(path);
			const second = harness(file);
			second.runner.recover();
			await second.runner.tick();
			expect(second.fake.execs).toEqual([]);
			expect(file.value[0]?.runs).toEqual([
				{
					at: T0 + HOUR,
					outcome: { kind: "command", run: { phase: "stopped", reason: "dashboard", output: "", startedAt: T0 + HOUR, endedAt: T0 + HOUR } },
					errors: ["The dashboard stopped while the command ran."],
				},
			]);
		});
	});

	describe("a routine that messages a Bot", () => {
		const toScout = (file: RoutinesFile, id: string): void =>
			void file.apply(
				{ op: "save", routine: { id, name: "Standup", cwd: "/work/webapp", schedules: [everyHour], task: { kind: "bot", botId: "scout" as BotId, prompt: "Post the standup." }, skill: null, enabled: true } },
				T0,
			);

		test("sends its prompt into the Bot's conversation while every session slot is busy", async () => {
			const file = fileWith(routinesPath());
			addPrompts(file, 3);
			toScout(file, "r4");
			const { runner, fake } = harness(file);
			fake.bots.set("scout", "s-scout");
			await runner.tick();
			expect(fake.requests).toHaveLength(3);
			expect(fake.messages).toEqual(["scout: Post the standup."]);
			expect(file.value[3]?.runs[0]).toEqual({ at: T0 + HOUR, outcome: { kind: "bot", botId: "scout" as BotId, sessionId: "s-scout" }, errors: [] });
		});

		test("a run whose Bot is gone records why", async () => {
			const file = new RoutinesFile(routinesPath());
			toScout(file, "r1");
			const { runner } = harness(file);
			await runner.runNow("r1");
			expect(file.value[0]?.runs[0]).toEqual({ at: T0 + HOUR, outcome: { kind: "pending", queued: false }, errors: ["Standup: This Bot is gone."] });
		});
	});
});
