import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostStatus, RoutineTask, StartRequest, StartResult } from "../shared";
import { RoutineRunner } from "./routine-runner";
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

/** A file at `path` holding one hourly routine created at {@link T0}. */
function fileWith(path: string, task: RoutineTask = { kind: "prompt", prompt: "Summarize yesterday's commits." }): RoutinesFile {
	const file = new RoutinesFile(path);
	file.apply({ op: "save", routine: { id: "r1", name: "Notes", cwd: "/work/webapp", schedules: [everyHour], task, skill: task.kind === "command" ? null : "ship", enabled: true } }, T0);
	return file;
}

/** Adds hourly prompt routines `r2` onward, so several can be due together. */
function addPrompts(file: RoutinesFile, count: number): void {
	for (let index = 2; index <= count; index++) {
		file.apply(
			{
				op: "save",
				routine: { id: `r${index}`, name: `Notes ${index}`, cwd: "/work/webapp", schedules: [everyHour], task: { kind: "prompt", prompt: `Prompt ${index}` }, skill: null, enabled: true },
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

/** A runner over `file` with a fake clock, starter, sessions, and commands. */
function harness(file: RoutinesFile) {
	const sessions = new Map<string, { status: HostStatus; ended: boolean }>();
	const fake = {
		now: T0 + HOUR,
		requests: [] as StartRequest[],
		/** The error the next starts answer with, or `null` to start. */
		failWith: null as string | null,
		sessions,
		execs: [] as FakeExec[],
	};
	const runner = new RoutineRunner({
		file,
		async start(request: StartRequest): Promise<StartResult> {
			fake.requests.push(request);
			if (fake.failWith !== null) return { ok: false, error: fake.failWith };
			const instanceId = `i${fake.requests.length}`;
			sessions.set(instanceId, { status: "unknown", ended: false });
			return { ok: true, instanceId, cwd: "/work/webapp", prompt: null };
		},
		session(instanceId) {
			const session = sessions.get(instanceId);
			if (!session || session.ended) return null;
			return {
				status: session.status,
				sessionId: `s-${instanceId}`,
				end: async () => {
					session.ended = true;
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
		expect(firstFile.routines[3]?.runs[0]?.queued).toBe(true);

		const file = new RoutinesFile(path);
		const second = harness(file);
		await second.runner.tick();
		expect(second.fake.requests).toHaveLength(1);
		expect(file.routines.map(routine => routine.runs[0]?.queued)).toEqual([false, false, false, false]);
		expect(file.routines.map(routine => routine.runs.length)).toEqual([1, 1, 1, 1]);
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
		expect(fake.requests).toMatchObject([{ kind: "new", cwd: "/work/webapp", skill: "ship", subject: null }]);
		const [request] = fake.requests;
		expect(request?.kind === "new" && request.prompt).toBe(
			"Summarize yesterday's commits. This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.",
		);
	});

	test("a start that fails records the error, and the next run tries again", async () => {
		const file = fileWith(routinesPath());
		const { runner, fake } = harness(file);
		fake.failWith = "omp is not installed";
		await runner.tick();
		expect(file.routines[0]?.runs[0]?.errors).toEqual(["Notes: omp is not installed"]);
		expect(file.routines[0]?.runs[0]?.started).toEqual([]);

		fake.failWith = null;
		fake.now += HOUR;
		await runner.tick();
		expect(fake.requests).toHaveLength(2);
		expect(file.routines[0]?.runs[0]?.started).toEqual([{ label: "Notes", instanceId: "i2", sessionId: "s-i2" }]);
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

	test("a prompt routine starts no second session while its last one still runs", async () => {
		const file = fileWith(routinesPath(), { kind: "prompt", prompt: "Summarize yesterday's commits." });
		const { runner, fake } = harness(file);
		await runner.tick();
		fake.now += HOUR;
		await runner.tick();
		expect(fake.requests.length).toBe(1);
		expect(file.routines[0]?.runs.map(run => [run.started.map(session => session.label), run.errors])).toEqual([
			[[], ["The last run's session is still running."]],
			[["Notes"], []],
		]);
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
			expect(file.routines[0]?.runs[0]).toEqual({ at: T0 + HOUR, queued: false, started: [], errors: [], command: { phase: "running", startedAt: T0 + HOUR } });

			fake.now += 4000;
			fake.execs[0]!.end({ exitCode: 0, output: "Removing worktrees/old\n" });
			await settled();
			expect(file.routines[0]?.runs[0]).toEqual({
				at: T0 + HOUR,
				queued: false,
				started: [],
				errors: [],
				command: { phase: "exited", code: 0, output: "Removing worktrees/old\n", startedAt: T0 + HOUR, endedAt: T0 + HOUR + 4000 },
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
			expect(file.routines[0]?.runs.map(run => run.errors)).toEqual([["The last run's command is still running."], []]);

			fake.execs[0]!.end({ exitCode: 3, output: "fatal: not a git repository\n" });
			await settled();
			expect(file.routines[0]?.runs[1]).toMatchObject({ errors: ["Exited with code 3."], command: { phase: "exited", code: 3, output: "fatal: not a git repository\n" } });

			fake.now += HOUR;
			await runner.tick();
			fake.execs[1]!.end({ exitCode: null, output: "" });
			await settled();
			expect(file.routines[0]?.runs[0]).toMatchObject({ errors: ["Stopped after 10 minutes."], command: { phase: "stopped", reason: "time-limit" } });
		});

		test("a command that cannot start saves why as its failure and its error", async () => {
			const file = fileWith(routinesPath(), command);
			const { runner, fake } = harness(file);
			await runner.tick();
			fake.execs[0]!.fail(new Error("/work/webapp is not a directory."));
			await settled();
			expect(file.routines[0]?.runs[0]).toMatchObject({
				errors: ["/work/webapp is not a directory."],
				command: { phase: "failed", error: "/work/webapp is not a directory." },
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
			await second.runner.tick();
			expect(second.fake.execs).toEqual([]);
			expect(file.routines[0]?.runs).toEqual([
				{
					at: T0 + HOUR,
					queued: false,
					started: [],
					errors: ["The dashboard stopped while the command ran."],
					command: { phase: "stopped", reason: "dashboard", output: "", startedAt: T0 + HOUR, endedAt: T0 + HOUR },
				},
			]);
		});
	});
});
