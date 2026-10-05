import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostStatus, InboxPullRequest, RoutineTask, StartRequest, StartResult } from "../shared";
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

const pr = (number: number, fields: Partial<InboxPullRequest> = {}): InboxPullRequest => ({
	owner: "acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	author: { login: "teammate", avatarUrl: null },
	reviewers: [],
	role: "reviewer",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	head: `teammate/branch-${number}`,
	headOid: `sha-${number}`,
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	updatedAt: 1,
	...fields,
});

/** A file at `path` holding one hourly routine created at {@link T0}. */
function fileWith(path: string, task: RoutineTask = { kind: "pull-requests", action: "review" }): RoutinesFile {
	const file = new RoutinesFile(path);
	const routine = { id: "r1", name: "Reviews", cwd: "/work/webapp", schedule: { kind: "every", minutes: 60 }, task, skill: "ship", enabled: true } as const;
	file.apply({ op: "save", routine }, T0);
	return file;
}

/** A runner over `file` with a fake clock, inbox, starter, and sessions. */
function harness(file: RoutinesFile, prs: InboxPullRequest[] = []) {
	const sessions = new Map<string, { status: HostStatus; ended: boolean }>();
	const fake = {
		now: T0 + HOUR,
		prs,
		requests: [] as StartRequest[],
		/** The error the next starts answer with, or `null` to start. */
		failWith: null as string | null,
		sessions,
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
		inbox: async () => fake.prs,
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
		onChange: () => {},
	});
	/** The pull request numbers each start was for, in order. */
	const started = (): (number | undefined)[] => fake.requests.map(request => (request.kind === "new" && request.subject?.kind === "pull-request" ? request.subject.pr.number : undefined));
	return { runner, fake, started };
}

describe("RoutineRunner", () => {
	test("a claimed run's queue survives a restart, and the next server drains it without claiming again", async () => {
		const path = routinesPath();
		const first = harness(fileWith(path), [pr(1), pr(2), pr(3), pr(4), pr(5)]);
		await first.runner.tick();
		expect(first.started()).toEqual([1, 2, 3]);

		const file = new RoutinesFile(path);
		const second = harness(file, first.fake.prs);
		await second.runner.tick();
		expect(second.started()).toEqual([4, 5]);
		expect(file.routines[0]?.runs.map(run => run.queue)).toEqual([[]]);
		expect(file.routines[0]?.done).toEqual({ "acme/webapp#1": "sha-1", "acme/webapp#2": "sha-2", "acme/webapp#3": "sha-3", "acme/webapp#4": "sha-4", "acme/webapp#5": "sha-5" });
	});

	test("no more than three routine sessions run at once, and a freed slot takes the next pull request", async () => {
		const { runner, fake, started } = harness(fileWith(routinesPath()), [pr(1), pr(2), pr(3), pr(4)]);
		await runner.tick();
		for (const session of fake.sessions.values()) session.status = "working";
		await runner.tick();
		expect(started()).toEqual([1, 2, 3]);
		fake.sessions.get("i1")!.status = "idle";
		await runner.tick();
		await runner.tick();
		expect(fake.sessions.get("i1")?.ended).toBe(true);
		expect(started()).toEqual([1, 2, 3, 4]);
	});

	test("each start takes the action's prompt with the unattended suffix, in the routine's workspace and skill", async () => {
		const { runner, fake } = harness(fileWith(routinesPath()), [pr(7)]);
		await runner.tick();
		expect(fake.requests).toMatchObject([{ kind: "new", cwd: "/work/webapp", skill: "ship", subject: { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 7 } } }]);
		const [request] = fake.requests;
		expect(request?.kind === "new" && request.prompt.startsWith("Pull request https://github.com/acme/webapp/pull/7 (\"PR 7\")")).toBe(true);
		expect(request?.kind === "new" && request.prompt.endsWith(" This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.")).toBe(true);
	});

	test("a start that fails stays out of done, and the next run takes the pull request again", async () => {
		const file = fileWith(routinesPath());
		const { runner, fake, started } = harness(file, [pr(1)]);
		fake.failWith = "omp is not installed";
		await runner.tick();
		expect(file.routines[0]?.runs[0]?.errors).toEqual(["acme/webapp#1: omp is not installed"]);
		expect(file.routines[0]?.done).toEqual({});

		fake.failWith = null;
		fake.now += HOUR;
		await runner.tick();
		expect(started()).toEqual([1, 1]);
		expect(file.routines[0]?.runs[0]?.started).toEqual([{ label: "acme/webapp#1", instanceId: "i2", sessionId: "s-i2" }]);
		expect(file.routines[0]?.done).toEqual({ "acme/webapp#1": "sha-1" });
	});

	test("a session that worked and went idle ends, and one idle before it ever worked keeps running", async () => {
		const { runner, fake } = harness(fileWith(routinesPath()), [pr(1), pr(2)]);
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
		const { runner, fake } = harness(fileWith(routinesPath()), [pr(1)]);
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
			[["Reviews"], []],
		]);
	});
});
