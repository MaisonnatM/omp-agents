import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcLaunch } from "../omp/rpc";
import type { Project } from "../shared/projects";
import type { HostStatus, StartRequest, StartResult } from "../shared/sessions";
import { type ProjectLaunch, ProjectRunner } from "./project-runner";
import { projectTools } from "./project-tools";
import { ProjectsFile, parseProjects } from "./projects-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-10-10T08:00:00Z");
const TOOL_NAMES = ["start_worker", "list_workers", "read_worker", "message_worker"];

interface FakeSession {
	instanceId: string;
	sessionId: string;
	cwd: string;
	status: HostStatus;
	requests: { id: string; title: string }[];
	/** The prompts omp took. */
	prompts: string[];
	/** Every prompt sent, taken or not. */
	attempts: number;
	/** omp refuses every prompt while set. */
	refuses: boolean;
	/** `projects.json` as omp's extension would read it at the session's first prompt. */
	firstPromptSaw: Project[] | null;
	alive: boolean;
}

interface Harness {
	runner: ProjectRunner;
	file: ProjectsFile;
	sessions: Map<string, FakeSession>;
	launches: { request: StartRequest; project: ProjectLaunch | null; launch: RpcLaunch }[];
	seeded: string[];
	/** The next start fails as omp would, after the runner chose its launch. */
	failNextStart(): void;
	/** Settles at the first change, from now on, after which `done` holds. */
	until(done: () => boolean): Promise<void>;
	/** The starter the runner uses. */
	start(request: StartRequest, project: ProjectLaunch | null): Promise<StartResult>;
}

function projectsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-project-runner-"));
	dirs.push(dir);
	return join(dir, "projects.json");
}

/**
 * A runner over the file at `path`, whose starter spawns fake sessions in the order `start.ts` keeps: the runner's
 * launch, the spawn, the link, then a new session's first message.
 */
function harness(path = projectsPath(), sessions = new Map<string, FakeSession>()): Harness {
	const file = new ProjectsFile(path);
	const launches: Harness["launches"] = [];
	const seeded: string[] = [];
	const waiters: { done: () => boolean; resolve: () => void }[] = [];
	let failing = false;
	let ids = 0;
	const live = (session: FakeSession | undefined) =>
		session?.alive
			? {
					sessionId: session.sessionId,
					status: session.status,
					requests: session.requests,
					prompt: async (text: string) => {
						session.attempts++;
						if (session.refuses) throw new Error("omp is gone");
						session.prompts.push(text);
					},
				}
			: null;
	const start = async (request: StartRequest, project: ProjectLaunch | null): Promise<StartResult> => {
		if (request.kind === "fork") return { ok: false, error: "no forks here" };
		const join = runner.launchFor(request, project);
		launches.push({ request, project, launch: join.rpc });
		if (failing) {
			failing = false;
			return { ok: false, error: "Cannot start omp: it crashed" };
		}
		const instanceId = `i${sessions.size + 1}`;
		const sessionId = request.kind === "resume" ? request.sessionId : `s-${instanceId}`;
		const cwd = request.kind === "new" ? request.cwd : "/work/app";
		const session: FakeSession = { instanceId, sessionId, cwd, status: "idle", requests: [], prompts: [], attempts: 0, refuses: false, firstPromptSaw: null, alive: true };
		sessions.set(instanceId, session);
		join.attach(session);
		if (request.kind === "new") {
			session.firstPromptSaw = parseProjects(JSON.parse(readFileSync(path, "utf8")))?.projects ?? null;
			session.status = "working";
		}
		return { ok: true, instanceId, cwd, prompt: null };
	};
	const runner: ProjectRunner = new ProjectRunner({
		file,
		start,
		session: instanceId => live(sessions.get(instanceId)),
		bySessionId: sessionId => live([...sessions.values()].find(session => session.alive && session.sessionId === sessionId)),
		interrupted: () => true,
		extensionArgs: () => ["-e", "/repo/projects.ts"],
		seedNotes: id => seeded.push(id),
		now: () => T0,
		newId: () => `id${++ids}`,
		onChange() {
			for (const waiter of waiters.splice(0)) {
				if (waiter.done()) waiter.resolve();
				else waiters.push(waiter);
			}
		},
	});
	const until = (done: () => boolean): Promise<void> => {
		const { promise, resolve } = Promise.withResolvers<void>();
		waiters.push({ done, resolve });
		return promise;
	};
	return { runner, file, sessions, launches, seeded, failNextStart: () => (failing = true), until, start };
}

/** The coordinator's own `start_worker` tool. */
const startWorker = (h: Harness, projectId: string, params: { title: string; prompt: string; cwd: string | null }) =>
	projectTools(projectId, h.runner)
		.find(tool => tool.name === "start_worker")!
		.execute(params, { toolCallId: "t", signal: new AbortController().signal });

/** Creates a project and starts `workers` workers through the coordinator's own tool; the coordinator stays working. */
async function project(h: Harness, workers: number): Promise<{ projectId: string; coordinator: FakeSession; worker: (n: number) => FakeSession }> {
	const created = await h.runner.create({ name: "Billing", cwd: "/work/app", prompt: "Migrate billing.", model: null, thinking: "high" });
	if (!created.ok) throw new Error(created.error);
	const coordinator = h.sessions.get(created.instanceId)!;
	const projectId = h.file.projects[0]!.id;
	for (let n = 1; n <= workers; n++) await startWorker(h, projectId, { title: `Task ${n}`, prompt: `Do task ${n}.`, cwd: null });
	const worker = (n: number) => [...h.sessions.values()].find(session => session.sessionId === h.file.get(projectId)!.workers[n - 1]!.sessionId)!;
	return { projectId, coordinator, worker };
}

describe("ProjectRunner", () => {
	test("each session's first prompt finds its role on disk, the notes are seeded, and only the coordinator gets tools", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 1);
		expect(coordinator.firstPromptSaw).toMatchObject([{ id: projectId, name: "Billing", cwd: "/work/app", coordinator: { sessionId: coordinator.sessionId }, workers: [] }]);
		expect(worker(1).firstPromptSaw?.[0]?.workers).toMatchObject([{ id: "w1", title: "Task 1", sessionId: worker(1).sessionId, cwd: "/work/app" }]);
		expect(h.seeded).toEqual([projectId]);
		const [coordinatorStart, workerStart] = h.launches;
		expect(coordinatorStart?.request).toMatchObject({ kind: "new", cwd: "/work/app", prompt: "Migrate billing.", thinking: "high" });
		expect(coordinatorStart?.launch.tools.map(tool => tool.name)).toEqual(TOOL_NAMES);
		expect(coordinatorStart?.launch.args).toEqual(["-e", "/repo/projects.ts"]);
		expect(workerStart?.launch).toEqual({ args: ["-e", "/repo/projects.ts"], tools: [] });
		expect(h.runner.launchFor({ kind: "resume", sessionId: "s-none" }, null).rpc).toEqual({ args: [], tools: [] });
	});

	test("workers take their ids as they attach and list in that order; a relative directory is the workspace's", async () => {
		const h = harness();
		const { projectId } = await project(h, 0);
		expect(await startWorker(h, projectId, { title: "Copy", prompt: "Write copy.", cwd: "web" })).toStartWith('Started w1 "Copy" in /work/app/web.');
		expect(await startWorker(h, projectId, { title: "Notes", prompt: "Read notes.", cwd: "~/notes" })).toStartWith('Started w2 "Notes" in ~/notes.');
		expect(await startWorker(h, projectId, { title: "Ops", prompt: "Check ops.", cwd: "/srv/ops" })).toStartWith('Started w3 "Ops" in /srv/ops.');
		expect(h.file.get(projectId)?.workers.map(({ id, title }) => `${id} ${title}`)).toEqual(["w1 Copy", "w2 Notes", "w3 Ops"]);
	});

	test("a worker that fails to start is an error for the coordinator and takes no id", async () => {
		const h = harness();
		const { projectId } = await project(h, 1);
		h.failNextStart();
		await expect(startWorker(h, projectId, { title: "Broken", prompt: "Crash.", cwd: null })).rejects.toThrow("Cannot start omp: it crashed");
		expect(h.file.get(projectId)?.workers.map(worker => worker.id)).toEqual(["w1"]);
		expect(await startWorker(h, projectId, { title: "Next", prompt: "Work.", cwd: null })).toStartWith('Started w2 "Next"');
	});

	test("a coordinator that fails to start leaves no project", async () => {
		const h = harness();
		h.failNextStart();
		expect(await h.runner.create({ name: "Billing", cwd: "/work/app", prompt: "Migrate billing.", model: null, thinking: null })).toEqual({ ok: false, error: "Cannot start omp: it crashed" });
		expect(h.file.projects).toEqual([]);
		expect(h.seeded).toEqual([]);
	});

	test("a finished turn saves the worker's last reply, and only its latest finished turn waits for the coordinator", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 1);
		h.runner.turnEnded(worker(1).instanceId, "first");
		h.runner.turnEnded(worker(1).instanceId, null);
		h.runner.turnEnded(worker(1).instanceId, "ok");
		const saved = h.file.get(projectId)!;
		expect(saved.updates).toMatchObject([{ workerId: "w1", kind: "finished" }]);
		expect(saved.workers[0]?.lastReply).toEqual({ at: new Date(T0).toISOString(), text: "ok" });
	});

	test("a repeated roster with the same requestId yields one asked update", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 1);
		const w1 = worker(1);
		w1.status = "needs-input";
		w1.requests = [{ id: "r1", title: "Which retry policy?" }];
		h.runner.observe(w1.instanceId);
		h.runner.observe(w1.instanceId);
		expect(h.file.get(projectId)!.updates).toMatchObject([{ kind: "asked", requestId: "r1", question: "Which retry policy?" }]);
	});

	test("updates wait while the coordinator works and are delivered once, coalesced, when it goes idle", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 2);
		h.runner.turnEnded(worker(1).instanceId, "ok");
		h.runner.turnEnded(worker(2).instanceId, "done");
		h.runner.observe(coordinator.instanceId);
		expect(coordinator.prompts).toEqual([]);
		const delivered = h.until(() => h.file.get(projectId)!.updates.length === 0);
		coordinator.status = "idle";
		h.runner.observe(coordinator.instanceId);
		h.runner.turnEnded(coordinator.instanceId, "Started both.");
		await delivered;
		expect(coordinator.prompts).toEqual([
			[
				"[omp-agents] Project update.",
				'- w1 "Task 1" finished its turn. Last reply:',
				"  ok",
				'- w2 "Task 2" finished its turn. Last reply:',
				"  done",
				"Use read_worker for more, message_worker to reply.",
			].join("\n"),
		]);
		h.runner.observe(coordinator.instanceId);
		expect(coordinator.attempts).toBe(1);
	});

	test("a prompt omp refuses keeps the updates, and the coordinator's next row change tries once more", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 1);
		coordinator.status = "idle";
		coordinator.refuses = true;
		h.runner.turnEnded(worker(1).instanceId, "ok");
		// The refused prompt settles in a few promise reactions.
		for (let turn = 0; turn < 10; turn++) await Promise.resolve();
		expect(coordinator.attempts).toBe(1);
		expect(h.file.get(projectId)!.updates).toHaveLength(1);
		coordinator.refuses = false;
		const delivered = h.until(() => h.file.get(projectId)!.updates.length === 0);
		h.runner.observe(coordinator.instanceId);
		await delivered;
		expect(coordinator.attempts).toBe(2);
		expect(coordinator.prompts).toHaveLength(1);
	});

	test("a resumed coordinator gets its tools again and the updates that waited for it", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 1);
		coordinator.alive = false;
		h.runner.exited(coordinator.instanceId);
		h.runner.turnEnded(worker(1).instanceId, "ok");
		expect(h.file.get(projectId)!.updates).toHaveLength(1);
		const delivered = h.until(() => h.file.get(projectId)!.updates.length === 0);
		const result = await h.start({ kind: "resume", sessionId: coordinator.sessionId }, null);
		if (!result.ok) throw new Error(result.error);
		expect(h.launches.at(-1)?.launch.tools.map(tool => tool.name)).toEqual(TOOL_NAMES);
		await delivered;
		const resumed = h.sessions.get(result.instanceId)!;
		expect(resumed.prompts).toHaveLength(1);
		expect(resumed.prompts[0]).toContain('w1 "Task 1" finished its turn. Last reply:\n  ok');
	});

	test("after a restart, a fresh runner over the same file delivers what waited exactly once", async () => {
		const before = harness();
		const { projectId, coordinator, worker } = await project(before, 1);
		before.runner.turnEnded(worker(1).instanceId, "ok");
		before.runner.stop();
		for (const session of before.sessions.values()) session.alive = false;
		before.file.flush();

		const after = harness(join(dirs.at(-1)!, "projects.json"), before.sessions);
		const delivered = after.until(() => after.file.get(projectId)!.updates.length === 0);
		const result = await after.start({ kind: "resume", sessionId: coordinator.sessionId }, null);
		if (!result.ok) throw new Error(result.error);
		await delivered;
		const resumed = after.sessions.get(result.instanceId)!;
		after.runner.observe(resumed.instanceId);
		after.runner.turnEnded(resumed.instanceId, "Noted.");
		expect(resumed.prompts).toHaveLength(1);
		expect(resumed.prompts[0]).toContain('w1 "Task 1" finished its turn');
	});

	test("messaging a stopped worker resumes it first", async () => {
		const h = harness();
		const { worker } = await project(h, 1);
		const w1 = worker(1);
		w1.alive = false;
		h.runner.exited(w1.instanceId);
		await h.runner.messageWorker(h.file.projects[0]!.workers[0]!, "Use PKCE.");
		expect(h.launches.at(-1)?.request).toEqual({ kind: "resume", sessionId: w1.sessionId });
		expect(h.launches.at(-1)?.launch.tools).toEqual([]);
		expect([...h.sessions.values()].at(-1)?.prompts).toEqual(["Use PKCE."]);
	});

	test("a stopped worker is news unless the dashboard is stopping, and a move follows the worker to its new session id", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 2);
		const w1 = worker(1);
		w1.sessionId = "s-moved";
		h.runner.switched(w1.instanceId);
		expect(h.file.roleOf("s-moved")).toEqual({ projectId, role: "worker", workerId: "w1" });
		w1.alive = false;
		h.runner.exited(w1.instanceId);
		expect(h.file.get(projectId)!.updates).toMatchObject([{ workerId: "w1", kind: "stopped" }]);
		h.runner.stop();
		h.runner.exited(worker(2).instanceId);
		expect(h.file.get(projectId)!.updates).toHaveLength(1);
	});
});
