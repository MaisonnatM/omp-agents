import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcLaunch } from "../omp/rpc";
import { HOME } from "../paths";
import type { Project, ProjectEvent } from "../shared/projects";
import type { HostStatus, StartRequest, StartResult, UserAnswer, UserRequest } from "../shared/sessions";
import { projectNotices } from "./notices";
import { occupiedBy, type ProjectLaunch, ProjectRunner } from "./project-runner";
import { projectTools } from "./project-tools";
import { ProjectsFile, parseProjects } from "./projects-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-10-10T08:00:00Z");
const TOOL_NAMES = ["start_worker", "list_workers", "read_worker", "message_worker", "answer_worker", "end_worker"];

interface FakeSession {
	instanceId: string;
	sessionId: string;
	cwd: string;
	status: HostStatus;
	/** A usage limit stopped its turn, and its continue waits. */
	held: boolean;
	requests: UserRequest[];
	/** The answers the session got. */
	answers: { requestId: string; answer: UserAnswer }[];
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
	/** The events written into each project's inbox, with their project and time. */
	inbox: { id: string; event: ProjectEvent; at: string }[];
	/** The next start fails as omp would, after the runner chose its launch. */
	failNextStart(): void;
	/** Settles at the first change, from now on, after which `done` holds. */
	until(done: () => boolean): Promise<void>;
	/** The starter the runner uses. */
	start(request: StartRequest, project: ProjectLaunch | null): Promise<StartResult>;
	/** The session ids ended through the runner. */
	ended: string[];
}

interface HarnessOptions {
	/** The branch checked out in every directory; `null` outside git. */
	checkedOut?: string | null;
	/** The session ids that ran when the last server stopped. */
	stoppedWithServer?: string[];
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
/** The bell's notices for `h`'s projects now. */
const notices = (h: ReturnType<typeof harness>) => projectNotices(h.runner.noticeFacts(), 0);

function harness(path = projectsPath(), sessions = new Map<string, FakeSession>(), options: HarnessOptions = {}): Harness {
	const file = new ProjectsFile(path);
	const launches: Harness["launches"] = [];
	const seeded: string[] = [];
	const inbox: Harness["inbox"] = [];
	const ended: string[] = [];
	const waiters: { done: () => boolean; resolve: () => void }[] = [];
	let failing = false;
	let ids = 0;
	const live = (session: FakeSession | undefined) =>
		session?.alive
			? {
					sessionId: session.sessionId,
					status: session.status,
					occupied: occupiedBy(session.status, session.held),
					requests: session.requests,
					prompt: async (text: string) => {
						session.attempts++;
						if (session.refuses) throw new Error("omp is gone");
						session.prompts.push(text);
					},
					answer: (requestId: string, answer: UserAnswer) => {
						session.answers.push({ requestId, answer });
						session.requests = session.requests.filter(request => request.id !== requestId);
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
		const session: FakeSession = { instanceId, sessionId, cwd, status: "idle", held: false, requests: [], answers: [], prompts: [], attempts: 0, refuses: false, firstPromptSaw: null, alive: true };
		sessions.set(instanceId, session);
		await join.attach(session);
		if (request.kind === "new") {
			session.firstPromptSaw = parseProjects(JSON.parse(readFileSync(path, "utf8")));
			session.status = "working";
		}
		return { ok: true, instanceId, cwd, prompt: null };
	};
	const runner: ProjectRunner = new ProjectRunner({
		file,
		start,
		session: instanceId => live(sessions.get(instanceId)),
		bySessionId: sessionId => live([...sessions.values()].find(session => session.alive && session.sessionId === sessionId)),
		async reach(sessionId) {
			const running = live([...sessions.values()].find(session => session.alive && session.sessionId === sessionId));
			if (running) return running;
			const result = await start({ kind: "resume", sessionId }, null);
			if (!result.ok) throw new Error(result.error);
			return live(sessions.get(result.instanceId))!;
		},
		async end(sessionId) {
			ended.push(sessionId);
			for (const session of sessions.values()) if (session.sessionId === sessionId) session.alive = false;
		},
		interrupted: () => true,
		stoppedWithServer: sessionId => options.stoppedWithServer?.includes(sessionId) ?? false,
		checkedOut: async () => options.checkedOut ?? null,
		extensionArgs: () => ["-e", "/repo/projects.ts"],
		seedNotes: id => seeded.push(id),
		writeInbox: (id, event, at) => inbox.push({ id, event, at }),
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
	return { runner, file, sessions, launches, seeded, inbox, failNextStart: () => (failing = true), until, start, ended };
}

/** The coordinator's own `start_worker` tool. */
const startWorker = (h: Harness, projectId: string, params: { title: string; prompt: string; cwd: string | null } & Record<string, string | null>) =>
	tool(h, projectId, "start_worker", params);

/** The coordinator's tool `name`. */
const tool = (h: Harness, projectId: string, name: string, params: Record<string, unknown>) =>
	projectTools(projectId, h.runner)
		.find(candidate => candidate.name === name)!
		.execute(params, { toolCallId: "t", signal: new AbortController().signal });

/** Creates a project and starts `workers` workers through the coordinator's own tool; the coordinator stays working. */
async function project(h: Harness, workers: number): Promise<{ projectId: string; coordinator: FakeSession; worker: (n: number) => FakeSession }> {
	const created = await h.runner.create({ name: "Billing", cwd: "/work/app", prompt: "Migrate billing.", model: null, thinking: "high" });
	if (!created.ok) throw new Error(created.error);
	const coordinator = h.sessions.get(created.instanceId)!;
	const projectId = h.file.value[0]!.id;
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
		expect(await startWorker(h, projectId, { title: "Notes", prompt: "Read notes.", cwd: "~/notes" })).toStartWith(`Started w2 "Notes" in ${HOME}/notes.`);
		expect(await startWorker(h, projectId, { title: "Ops", prompt: "Check ops.", cwd: "/srv/ops" })).toStartWith('Started w3 "Ops" in /srv/ops.');
		expect(h.file.get(projectId)?.workers.map(({ id, title }) => `${id} ${title}`)).toEqual(["w1 Copy", "w2 Notes", "w3 Ops"]);
	});

	test("a worker that fails to start is an error for the coordinator and takes no id", async () => {
		const h = harness();
		const { projectId } = await project(h, 1);
		h.failNextStart();
		await expect(startWorker(h, projectId, { title: "Broken", prompt: "Crash.", cwd: null })).rejects.toThrow("Cannot start omp: it crashed");
		expect(h.file.get(projectId)?.workers.map(worker => worker.id)).toEqual(["w1"]);
		expect(h.file.get(projectId)?.queue).toEqual([]);
		expect(h.file.get(projectId)?.updates).toEqual([]);
		expect(await startWorker(h, projectId, { title: "Next", prompt: "Work.", cwd: null })).toStartWith('Started w2 "Next"');
	});

	test("a coordinator that fails to start leaves no project", async () => {
		const h = harness();
		h.failNextStart();
		expect(await h.runner.create({ name: "Billing", cwd: "/work/app", prompt: "Migrate billing.", model: null, thinking: null })).toEqual({ ok: false, error: "Cannot start omp: it crashed" });
		expect(h.file.value).toEqual([]);
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
		w1.requests = [{ id: "r1", title: "Which retry policy?", deadline: null, kind: "text", multiline: false, placeholder: null, prefill: "" }];
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
		await h.runner.messageWorker(h.file.value[0]!.workers[0]!, "Use PKCE.");
		expect(h.launches.at(-1)?.request).toEqual({ kind: "resume", sessionId: w1.sessionId });
		expect(h.launches.at(-1)?.launch.tools).toEqual([]);
		expect([...h.sessions.values()].at(-1)?.prompts).toEqual(["Use PKCE."]);
	});

	test("a stopped worker is news, and a move follows the worker to its new session id", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 1);
		const w1 = worker(1);
		w1.sessionId = "s-moved";
		h.runner.switched(w1.instanceId);
		expect(h.file.roleOf("s-moved")).toEqual({ projectId, role: "worker", workerId: "w1" });
		w1.alive = false;
		h.runner.exited(w1.instanceId);
		expect(h.file.get(projectId)!.updates).toMatchObject([{ workerId: "w1", kind: "stopped" }]);
	});

	test("in a git checkout a worker gets a new branch from the checked-out one, a named one, or none", async () => {
		const h = harness(projectsPath(), new Map(), { checkedOut: "main" });
		const { projectId } = await project(h, 0);
		await startWorker(h, projectId, { title: "Fix Login!", prompt: "Fix it.", cwd: null, branch: null });
		await startWorker(h, projectId, { title: "Docs", prompt: "Write.", cwd: null, branch: "docs/billing" });
		await startWorker(h, projectId, { title: "Read", prompt: "Read.", cwd: null, branch: "none" });
		const branches = h.launches.slice(1).map(({ request }) => (request.kind === "new" ? request.branch : undefined));
		expect(branches[0]).toEqual({ kind: "new", name: expect.stringMatching(/^billing\/fix-login-[0-9a-z]{1,6}$/), base: "main" });
		expect(branches.slice(1)).toEqual([{ kind: "new", name: "docs/billing", base: "main" }, null]);
	});

	test("a worker starts on the model, thinking level, and skill it names", async () => {
		const h = harness(projectsPath(), new Map(), { checkedOut: "main" });
		const { projectId } = await project(h, 0);
		await startWorker(h, projectId, { title: "Review", prompt: "Review.", cwd: null, branch: "none", model: "anthropic/claude-haiku-5-5", thinking: "low", skill: "review" });
		expect(h.launches.at(-1)?.request).toMatchObject({ model: { provider: "anthropic", id: "claude-haiku-5-5" }, thinking: "low", skill: "review", branch: null });
		await expect(startWorker(h, projectId, { title: "X", prompt: "X.", cwd: null, model: "haiku" })).rejects.toThrow("model must read provider/id");
	});

	test("workers beyond the cap queue, persist, and start in order as busy ones finish", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 0);
		h.file.apply({ op: "max-workers", id: projectId, max: 1 });
		expect(await startWorker(h, projectId, { title: "One", prompt: "1.", cwd: null })).toStartWith('Started w1 "One"');
		expect(await startWorker(h, projectId, { title: "Two", prompt: "2.", cwd: null })).toStartWith('Queued "Two" at position 1');
		expect(await startWorker(h, projectId, { title: "Three", prompt: "3.", cwd: null })).toStartWith('Queued "Three" at position 2');
		expect(parseProjects(JSON.parse(JSON.stringify({ projects: h.file.value })))?.[0]?.queue.map(queued => queued.title)).toEqual(["Two", "Three"]);
		const started = h.until(() => h.file.get(projectId)!.workers.length === 2);
		worker(1).status = "idle";
		h.runner.turnEnded(worker(1).instanceId, "done");
		await started;
		expect(h.file.get(projectId)!.queue.map(queued => queued.title)).toEqual(["Three"]);
		expect(h.file.get(projectId)!.workers.map(({ id, title }) => `${id} ${title}`)).toEqual(["w1 One", "w2 Two"]);
	});

	test("answer_worker answers a worker's question in the form it asks, and end_worker ends it", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 1);
		const w1 = worker(1);
		w1.status = "needs-input";
		w1.requests = [
			{ id: "r1", title: "Proceed?", deadline: null, kind: "confirm", message: "Proceed?" },
			{ id: "r2", title: "Policy", deadline: null, kind: "select", options: [{ label: "Retry" }, { label: "Fail" }], checked: [] },
			{
				id: "r3",
				title: "Which languages?",
				deadline: null,
				kind: "ask",
				questions: [
					{ id: "langs", question: "Which languages?", header: null, options: [{ label: "TS" }, { label: "Go" }], multi: true, recommended: null },
					{ id: "db", question: "Database?", header: null, options: [{ label: "SQLite" }], multi: false, recommended: null },
				],
			},
		] as UserRequest[];
		expect(await tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r1", answer: "Yes" })).toStartWith("Answered w1.");
		await expect(tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r2", answer: "Maybe" })).rejects.toThrow('offers "Retry", "Fail"');
		await tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r2", answer: "retry" });
		await expect(tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r3", answer: "ts" })).rejects.toThrow("Answer each on its own line");
		await tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r3", answer: "ts, go\nMySQL" });
		expect(w1.answers).toEqual([
			{ requestId: "r1", answer: { kind: "confirm", confirmed: true } },
			{ requestId: "r2", answer: { kind: "value", value: "Retry" } },
			{
				requestId: "r3",
				answer: {
					kind: "ask",
					answers: [
						{ id: "langs", selected: ["TS", "Go"], custom: null },
						{ id: "db", selected: [], custom: "MySQL" },
					],
				},
			},
		]);
		await expect(tool(h, projectId, "answer_worker", { worker: "w1", requestId: "r9", answer: "x" })).rejects.toThrow("waits on no request r9");
		expect(await tool(h, projectId, "end_worker", { worker: "w1" })).toBe("Ended w1.");
		expect(h.ended).toEqual([w1.sessionId]);
		await expect(tool(h, projectId, "end_worker", { worker: "w1" })).rejects.toThrow("w1 does not run");
	});

	test("a worker the coordinator ends stops without news and frees its slot for the queue", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 0);
		h.file.apply({ op: "max-workers", id: projectId, max: 1 });
		await startWorker(h, projectId, { title: "One", prompt: "1.", cwd: null });
		await startWorker(h, projectId, { title: "Two", prompt: "2.", cwd: null });
		const w1 = worker(1);
		w1.status = "idle";
		await tool(h, projectId, "end_worker", { worker: "w1" });
		const started = h.until(() => h.file.get(projectId)!.workers.length === 2);
		h.runner.exited(w1.instanceId);
		await started;
		expect(h.file.get(projectId)!.updates).toEqual([]);
	});

	test("endFinished ends a worker the cleanup after a merge finished, as end_worker does, then tells the coordinator, and rejects one that is gone", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 1);
		const w1 = worker(1);
		await expect(h.runner.endFinished(projectId, "w9")).rejects.toThrow(`Project ${projectId} has no worker w9.`);
		await h.runner.endFinished(projectId, "w1");
		expect(h.ended).toEqual([w1.sessionId]);
		h.runner.exited(w1.instanceId);
		expect(h.file.get(projectId)!.updates).toMatchObject([{ kind: "event", source: "GitHub", title: 'Ended w1 "Task 1"', text: "Idle, with every pull request merged or closed.", url: null }]);
		await expect(h.runner.endFinished(projectId, "w1")).rejects.toThrow("w1 does not run.");
	});

	test("a held worker reads idle but keeps its slot until its hold ends", async () => {
		const h = harness();
		const { projectId, worker } = await project(h, 0);
		h.file.apply({ op: "max-workers", id: projectId, max: 1 });
		await startWorker(h, projectId, { title: "One", prompt: "1.", cwd: null });
		const w1 = worker(1);
		w1.status = "idle";
		w1.held = true;
		expect(await startWorker(h, projectId, { title: "Two", prompt: "2.", cwd: null })).toStartWith('Queued "Two" at position 1');
		expect(h.runner.phaseOf(h.file.get(projectId)!.workers[0]!)).toBe("idle");
		const started = h.until(() => h.file.get(projectId)!.workers.length === 2);
		w1.held = false;
		h.runner.turnEnded(w1.instanceId, "done");
		await started;
		expect(h.file.get(projectId)!.workers.map(({ id, title }) => `${id} ${title}`)).toEqual(["w1 One", "w2 Two"]);
	});

	test("a held coordinator gets no updates and leaves worker questions to itself; a held worker keeps the project from done", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 2);
		const [w1, w2] = [worker(1), worker(2)];
		coordinator.status = "idle";
		coordinator.held = true;
		w1.status = "needs-input";
		w1.requests = [{ id: "r1", title: "Which retry policy?", deadline: null, kind: "text", multiline: false, placeholder: null, prefill: "" }];
		h.runner.observe(w1.instanceId);
		expect([coordinator.attempts, h.file.get(projectId)!.updates.map(update => update.kind), notices(h)]).toEqual([0, ["asked"], []]);
		const asked = h.until(() => h.file.get(projectId)!.updates.length === 0);
		coordinator.held = false;
		h.runner.observe(coordinator.instanceId);
		await asked;
		expect(notices(h)).toMatchObject([{ id: `project:${projectId}:w1:asks:r1`, about: "asks" }]);

		w1.status = "idle";
		w1.requests = [];
		w2.status = "idle";
		w2.held = true;
		const finished = h.until(() => h.file.get(projectId)!.updates.length === 0);
		h.runner.turnEnded(w1.instanceId, "ok");
		await finished;
		expect(notices(h)).toEqual([]);
		w2.held = false;
		expect(notices(h)).toMatchObject([{ about: "done", worker: null }]);
	});

	test("after a restart, a coordinator that stopped with the server resumes and hears which workers stopped", async () => {
		const before = harness();
		const { projectId, coordinator, worker } = await project(before, 2);
		before.runner.stop();
		for (const session of before.sessions.values()) session.alive = false;
		before.file.flush();

		const after = harness(join(dirs.at(-1)!, "projects.json"), before.sessions, { stoppedWithServer: [coordinator.sessionId, worker(2).sessionId] });
		const delivered = after.until(() => after.file.get(projectId)!.updates.length === 0);
		after.runner.recover();
		const resumed = [...after.sessions.values()].at(-1)!;
		resumed.status = "idle";
		after.runner.observe(resumed.instanceId);
		await delivered;
		expect(resumed.sessionId).toBe(coordinator.sessionId);
		expect(resumed.prompts[0]).toContain('The dashboard restarted and stopped w2 "Task 2".');
	});

	test("an event from outside reaches the coordinator with its source, title, link, and text, and lands in the project's inbox", async () => {
		const h = harness();
		const { projectId, coordinator } = await project(h, 0);
		const delivered = h.until(() => h.file.get(projectId)!.updates.length === 0);
		coordinator.status = "idle";
		const event = { source: "GitHub", title: "Checks failed on #12", text: "lint", url: "https://github.com/o/r/pull/12" };
		expect(h.runner.notify(projectId, event)).toBeNull();
		await delivered;
		expect(coordinator.prompts[0]).toContain("- GitHub: Checks failed on #12 (https://github.com/o/r/pull/12)\n  lint");
		expect(h.inbox).toEqual([{ id: projectId, event, at: new Date(T0).toISOString() }]);
		h.file.apply({ op: "archive", id: projectId });
		expect(h.runner.notify(projectId, event)).toContain("archived");
		expect(h.inbox).toHaveLength(1);
	});

	test("an archived project keeps its updates until it is unarchived", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 1);
		h.file.apply({ op: "archive", id: projectId });
		h.runner.turnEnded(worker(1).instanceId, "ok");
		coordinator.status = "idle";
		h.runner.observe(coordinator.instanceId);
		expect(coordinator.prompts).toEqual([]);
		const delivered = h.until(() => h.file.get(projectId)!.updates.length === 0);
		h.file.apply({ op: "unarchive", id: projectId });
		h.runner.settle(projectId);
		await delivered;
		expect(coordinator.prompts[0]).toContain("w1");
	});

	test("a worker's question is a notice once the coordinator is idle, and a settled project is done", async () => {
		const h = harness();
		const { projectId, coordinator, worker } = await project(h, 1);
		const w1 = worker(1);
		w1.status = "needs-input";
		w1.requests = [{ id: "r1", title: "Which retry policy?", deadline: null, kind: "text", multiline: false, placeholder: null, prefill: "" }];
		expect(notices(h)).toEqual([]);
		coordinator.status = "idle";
		expect(notices(h)).toMatchObject([{ id: `project:${projectId}:w1:asks:r1`, about: "asks", worker: { id: "w1" }, text: "Which retry policy?" }]);
		w1.status = "idle";
		w1.requests = [];
		h.runner.turnEnded(w1.instanceId, "ok");
		expect(notices(h)).toEqual([]);
		h.file.apply({ op: "archive", id: projectId });
		expect(notices(h)).toEqual([]);
		h.file.apply({ op: "unarchive", id: projectId });
		await h.until(() => h.file.get(projectId)!.updates.length === 0);
		expect(notices(h)).toMatchObject([{ about: "done", worker: null }]);
	});
});
