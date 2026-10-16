/**
 * Runs projects: starts each coordinator and its workers as dashboard sessions, follows the live ones by instance id,
 * and brings what workers do to their coordinator. A worker's finished turn, its question, or its stop becomes an update,
 * saved in `projects.json` until the coordinator is live and idle, then sent to it as one follow-up prompt; an archived
 * project keeps them until it is unarchived.
 * A session's role is keyed by session id on disk, so a resumed coordinator gets its tools again.
 * Every worker joins the project's queue, also saved, and starts once the project has a free slot; it leaves the queue
 * in the same change that adds it to the project. A worker the coordinator ends, or the runner ends once its pull
 * requests merged, stops without news.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorText } from "../json";
import { agentDir } from "../omp/config";
import { PLAIN_LAUNCH, type RpcLaunch } from "../omp/rpc";
import { expandHome } from "../paths";
import { type ModelOption, modelOfSelector } from "../shared/models";
import type { SessionPreset } from "../shared/presets";
import { slug } from "../shared/slug";
import { isBusy, type Project, type ProjectEvent, type QueuedWorker, type Worker, type WorkerId, type WorkerPhase, type WorkerStart, workerPhase } from "../shared/projects";
import { type HostStatus, newSessionRequest, type StartRequest, type StartResult, type UserAnswer, type UserRequest } from "../shared/sessions";
import { type ProjectControl, projectTools, updateText, type WorkerSpec, type WorkerStarted } from "./project-tools";
import type { ProjectFacts } from "./notices";
import type { ProjectRole, ProjectsFile, UpdateBody } from "./projects-file";
import { ompTemplateDir } from "./resources";

/**
 * Why the runner starts a session, which the starter takes beside the request and the page never sends: a new
 * project's coordinator, a new worker, or a resumed session that rejoins the project it belongs to.
 */
export type ProjectLaunch =
	| { kind: "create"; projectId: string; name: string; goal: string }
	| { kind: "new-worker"; projectId: string; queuedId: string; title: string }
	| { kind: "rejoin"; role: ProjectRole };

/** How a start joins its project: what omp launches with, and what links the session once it is in the registry, before its first prompt. */
export interface ProjectJoin {
	rpc: RpcLaunch;
	attach(session: { instanceId: string; sessionId: string; cwd: string }): void;
}

const NO_PROJECT: ProjectJoin = { rpc: PLAIN_LAUNCH, attach() {} };

/**
 * Loads the `projects` extension from the starter kit's template when `bun run omp-template` has not installed it, so a
 * project session gets its instructions either way. Never both: omp loads two copies at two paths twice.
 */
export function projectsExtensionArgs(): string[] {
	if (existsSync(join(agentDir, "extensions", "projects.ts"))) return [];
	return ["-e", join(ompTemplateDir, "agent", "extensions", "projects.ts")];
}

/** What the runner asks of a live session. */
export interface RunnerSession {
	sessionId: string;
	status: HostStatus;
	requests: UserRequest[];
	/** Sends `text` as a follow-up while a turn runs, else as a prompt; rejects when omp does not take it. */
	prompt(text: string): Promise<void>;
	answer(requestId: string, answer: UserAnswer): void;
}

export interface ProjectRunnerDeps {
	file: ProjectsFile;
	/** Starts `request` as a session of the project `project` names; with `null`, a resume rejoins its own project. */
	start(request: StartRequest, project: ProjectLaunch | null): Promise<StartResult>;
	/** Live session `instanceId`, or `null` once it is gone. */
	session(instanceId: string): RunnerSession | null;
	/** The live session with id `sessionId`, or `null` when none runs. */
	bySessionId(sessionId: string): RunnerSession | null;
	/** The live session that continues `sessionId`, else that session resumed; rejects when it does not resume. */
	reach(sessionId: string): Promise<RunnerSession>;
	/** Ends live session `sessionId` as End session does. */
	end(sessionId: string): Promise<void>;
	/** Whether past session `sessionId` stopped without End session. */
	interrupted(sessionId: string): boolean;
	/** Whether session `sessionId` ran when the last server stopped. */
	stoppedWithServer(sessionId: string): boolean;
	/** The saved preset `id`, or `null` when there is none. */
	preset(id: string): SessionPreset | null;
	/** The branch checked out in `cwd`, or `null` outside git or on a detached head. */
	checkedOut(cwd: string): Promise<string | null>;
	/** The `omp` arguments that load the `projects` extension when omp does not already. */
	extensionArgs(): string[];
	/** Creates project `id`'s notes for a project named `name` working on `goal`. */
	seedNotes(id: string, name: string, goal: string): void;
	/** Writes outside event `event`, which came at `at`, into project `id`'s inbox in its notes. */
	writeInbox(id: string, event: ProjectEvent, at: string): void;
	now(): number;
	newId(): string;
	/** The projects changed; every socket should hear them. */
	onChange(): void;
}

/** A started worker: its id in the project, and the directory it runs in. */
type Launched = { workerId: WorkerId; cwd: string };

/** A live session of a project, by instance id. */
interface Tracked {
	role: ProjectRole;
	sessionId: string;
	/** The request ids of the questions the coordinator was told about. */
	asked: Set<string>;
}

export interface ProjectSpec {
	name: string;
	cwd: string;
	/** The coordinator's first message, which the notes keep as the goal. */
	prompt: string;
	model: ModelOption | null;
	thinking: string | null;
}

/** `text` as a branch name's segment, at most 40 characters. */
const branchSlug = (text: string): string => slug(text, "worker", 40);

/** `answer` as the reply `request` takes: an option's label, yes or no, or text. */
function answerFor(request: UserRequest, answer: string): UserAnswer {
	const value = answer.trim();
	switch (request.kind) {
		case "confirm": {
			const word = value.toLowerCase();
			if (["yes", "y", "true", "confirm"].includes(word)) return { kind: "confirm", confirmed: true };
			if (["no", "n", "false", "cancel"].includes(word)) return { kind: "confirm", confirmed: false };
			throw new Error(`Request ${request.id} asks yes or no: ${JSON.stringify(request.message)}. Answer yes or no.`);
		}
		case "select": {
			const option = request.options.find(candidate => candidate.label.trim().toLowerCase() === value.toLowerCase());
			if (!option) throw new Error(`Request ${request.id} offers ${request.options.map(candidate => JSON.stringify(candidate.label)).join(", ")}. Answer with one of them.`);
			return { kind: "value", value: option.label };
		}
		case "text":
			return { kind: "value", value: answer };
		default: {
			const unhandled: never = request;
			return unhandled;
		}
	}
}

export class ProjectRunner implements ProjectControl {
	readonly #deps: ProjectRunnerDeps;
	readonly #tracked = new Map<string, Tracked>();
	/** Projects with an update prompt on its way to the coordinator. */
	readonly #sending = new Set<string>();
	/** Queued workers starting now, by queue id, with their project's id; each takes a slot before its session reports its status. */
	readonly #launching = new Map<string, string>();
	/** The live workers, by instance id, that the coordinator or the runner is ending, whose exit is no news. */
	readonly #ending = new Set<string>();
	/** Set as the dashboard stops: its sessions exit with it, which is no news for a coordinator. */
	#stopping = false;

	constructor(deps: ProjectRunnerDeps) {
		this.#deps = deps;
	}

	project(projectId: string): Project | undefined {
		return this.#deps.file.get(projectId);
	}

	/**
	 * How `request` starts: in the project `project` names, else, for a resume, in the project its session belongs to.
	 * A project session loads the extension, and a coordinator gets its tools.
	 */
	launchFor(request: StartRequest, project: ProjectLaunch | null): ProjectJoin {
		const launch = project ?? this.#rejoinOf(request);
		if (!launch) return NO_PROJECT;
		const coordinated = coordinatedBy(launch);
		return {
			rpc: { args: this.#deps.extensionArgs(), tools: coordinated === null ? [] : projectTools(coordinated, this) },
			attach: session => this.#attach(launch, session),
		};
	}

	/** Starts a project's coordinator on `spec.prompt`; the project exists once the coordinator does. */
	create(spec: ProjectSpec): Promise<StartResult> {
		const request = newSessionRequest(spec.cwd, spec.prompt, { model: spec.model, thinking: spec.thinking });
		return this.#deps.start(request, { kind: "create", projectId: this.#deps.newId(), name: spec.name, goal: spec.prompt });
	}

	/**
	 * The dashboard started and took the unattended work. Each project whose sessions ran when the last server stopped
	 * tells its coordinator which workers stopped, and a coordinator that stopped with it resumes to hear it.
	 */
	recover(): void {
		for (const project of this.#deps.file.value) {
			if (project.archived) continue;
			const stopped = project.workers.filter(worker => this.#deps.stoppedWithServer(worker.sessionId)).map(worker => worker.id);
			const coordinatorStopped = this.#deps.stoppedWithServer(project.coordinator.sessionId);
			if (stopped.length > 0 || coordinatorStopped) this.#save(project.id, [{ kind: "restarted", workers: stopped }]);
			if (coordinatorStopped) {
				void this.#deps.reach(project.coordinator.sessionId).catch((error: unknown) => console.error(`omp-agents: cannot resume ${project.name}'s coordinator: ${errorText(error)}`));
			}
			this.settle(project.id);
		}
	}

	/** Saves `event` for project `projectId`'s coordinator, and writes it into the project's inbox; why it cannot, or `null` once saved. */
	notify(projectId: string, event: ProjectEvent): string | null {
		const project = this.#deps.file.get(projectId);
		if (!project) return "its project no longer exists.";
		if (project.archived) return `project ${project.name} is archived.`;
		try {
			this.#deps.writeInbox(projectId, event, this.#now());
		} catch (error) {
			console.error(`omp-agents: cannot write ${project.name}'s inbox: ${errorText(error)}`);
		}
		this.#save(projectId, [{ kind: "event", ...event }]);
		this.settle(projectId);
		return null;
	}

	/** Session `instanceId`'s row changed: a worker may ask a question, and a coordinator may have gone idle. */
	observe(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		const session = this.#deps.session(instanceId);
		if (!tracked || !session) return;
		const { role, asked } = tracked;
		if (role.role === "worker") {
			const news = session.requests.filter(request => !asked.has(request.id));
			for (const request of news) asked.add(request.id);
			this.#save(role.projectId, news.map(request => ({ kind: "asked", workerId: role.workerId, requestId: request.id, question: request.title })));
		}
		this.settle(role.projectId);
	}

	/** Session `instanceId` finished a turn that ended on `reply`. */
	turnEnded(instanceId: string, reply: string | null): void {
		const tracked = this.#tracked.get(instanceId);
		if (!tracked) return;
		const { role } = tracked;
		if (role.role === "worker") {
			this.#deps.file.apply({ op: "reply", id: role.projectId, workerId: role.workerId, reply: { at: this.#now(), text: reply ?? "" } });
			this.#save(role.projectId, [{ kind: "finished", workerId: role.workerId }]);
		}
		this.settle(role.projectId);
	}

	/** Session `instanceId`'s process exited. */
	exited(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		if (!tracked) return;
		this.#tracked.delete(instanceId);
		const asked = this.#ending.delete(instanceId);
		const { role } = tracked;
		if (role.role !== "worker" || this.#stopping) return;
		// An end the coordinator or the runner asked for is no news, but it frees a slot.
		if (!asked) this.#save(role.projectId, [{ kind: "stopped", workerId: role.workerId }]);
		this.settle(role.projectId);
	}

	/** Session `instanceId` moved to another session id, after a `/move` or an edited prompt; its project follows it. */
	switched(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		const session = this.#deps.session(instanceId);
		if (!tracked || !session || session.sessionId === tracked.sessionId) return;
		this.#deps.file.apply({ op: "relink", from: tracked.sessionId, to: session.sessionId });
		tracked.sessionId = session.sessionId;
		this.#deps.onChange();
	}

	/** The dashboard stops: the sessions that exit now report no news. */
	stop(): void {
		this.#stopping = true;
	}

	phaseOf(worker: Worker): WorkerPhase {
		return workerPhase(this.#deps.bySessionId(worker.sessionId)?.status ?? null, this.#deps.interrupted(worker.sessionId));
	}

	questionsOf(worker: Worker): { id: string; title: string }[] {
		return this.#deps.bySessionId(worker.sessionId)?.requests.map(({ id, title }) => ({ id, title })) ?? [];
	}

	async startWorker(project: Project, spec: WorkerSpec): Promise<WorkerStarted> {
		const queued: QueuedWorker = { id: this.#deps.newId(), title: spec.title, at: this.#now(), start: await this.#workerStart(project, spec) };
		this.#deps.file.apply({ op: "enqueue", id: project.id, worker: queued });
		const launch = this.#drain(project.id, queued.id);
		if (launch) return { kind: "started", ...(await launch) };
		this.#deps.onChange();
		const waiting = this.#deps.file.get(project.id)?.queue.filter(entry => !this.#launching.has(entry.id)) ?? [];
		return { kind: "queued", position: waiting.findIndex(entry => entry.id === queued.id) + 1 };
	}

	async messageWorker(worker: Worker, text: string): Promise<void> {
		const session = await this.#deps.reach(worker.sessionId).catch((error: unknown) => {
			throw new Error(`${worker.id}: ${errorText(error)}`);
		});
		await session.prompt(text);
	}

	answerWorker(worker: Worker, requestId: string, answer: string): void {
		const session = this.#deps.bySessionId(worker.sessionId);
		if (!session) throw new Error(`${worker.id} does not run, so it waits on no question.`);
		const request = session.requests.find(candidate => candidate.id === requestId);
		if (!request) throw new Error(`${worker.id} waits on no request ${requestId}. read_worker lists the ones it waits on.`);
		session.answer(requestId, answerFor(request, answer));
	}

	async endWorker(worker: Worker): Promise<void> {
		if (!this.#deps.bySessionId(worker.sessionId)) throw new Error(`${worker.id} does not run.`);
		await this.#end(worker);
	}

	/**
	 * Ends worker `workerId` of project `projectId` as end_worker does, when it runs and is idle; whether it began to.
	 * The watch calls it once the worker's pull requests are all merged or closed, which leaves it nothing to do.
	 */
	endIdle(projectId: string, workerId: WorkerId): boolean {
		const project = this.#deps.file.get(projectId);
		const worker = project && !project.archived ? project.workers.find(candidate => candidate.id === workerId) : undefined;
		if (!project || !worker || this.#deps.bySessionId(worker.sessionId)?.status !== "idle") return false;
		void this.#end(worker).catch((error: unknown) => console.error(`omp-agents: cannot end ${worker.id} of project ${project.name}: ${errorText(error)}`));
		return true;
	}

	/** Ends the worker's session; the exit it causes is no news for the coordinator. */
	async #end(worker: Worker): Promise<void> {
		const instanceId = [...this.#tracked].find(([, tracked]) => tracked.sessionId === worker.sessionId)?.[0];
		if (instanceId !== undefined) this.#ending.add(instanceId);
		try {
			await this.#deps.end(worker.sessionId);
		} catch (error) {
			if (instanceId !== undefined) this.#ending.delete(instanceId);
			throw error;
		}
	}

	/** Every project not archived, as its notices see it. */
	noticeFacts(): ProjectFacts[] {
		return this.#deps.file.value
			.filter(project => !project.archived)
			.map(project => ({
				project,
				coordinator: this.#deps.bySessionId(project.coordinator.sessionId)?.status ?? null,
				workers: project.workers.map(worker => ({ worker, phase: this.phaseOf(worker), questions: this.questionsOf(worker) })),
			}));
	}

	/** Something about project `projectId` changed: its waiting updates go to an idle coordinator, and its queued workers take free slots. */
	settle(projectId: string): void {
		this.#deliver(projectId);
		this.#drain(projectId);
	}

	/**
	 * Starts project `projectId`'s queued workers, oldest first, while it has free slots. The start of queued worker `own`
	 * comes back for its caller to await; any other start that fails becomes an update for the coordinator.
	 */
	#drain(projectId: string, own: string | null = null): Promise<Launched> | null {
		const project = this.#deps.file.get(projectId);
		if (!project || project.archived || this.#stopping) return null;
		let free = project.maxWorkers - this.#busy(project);
		let ownLaunch: Promise<Launched> | null = null;
		for (const queued of project.queue) {
			if (free <= 0) break;
			if (this.#launching.has(queued.id)) continue;
			free--;
			const launch = this.#launch(projectId, queued);
			if (queued.id === own) ownLaunch = launch;
			else
				launch.catch((error: unknown) => {
					this.#save(projectId, [{ kind: "event", source: "omp-agents", title: `Queued worker ${JSON.stringify(queued.title)} did not start`, text: errorText(error), url: null }]);
					this.#deliver(projectId);
				});
		}
		return ownLaunch;
	}

	/** How many of `project`'s slots are taken: its working or asking workers, and the ones starting. */
	#busy(project: Project): number {
		const launching = [...this.#launching.values()].filter(id => id === project.id).length;
		return project.workers.filter(worker => isBusy(this.phaseOf(worker))).length + launching;
	}

	/** How `spec` starts: its directory resolved, its preset applied, and its branch named. */
	async #workerStart(project: Project, spec: WorkerSpec): Promise<WorkerStart> {
		// `~` is the home directory; any other relative directory is the workspace's.
		const cwd = spec.cwd === null ? project.cwd : resolve(project.cwd, expandHome(spec.cwd));
		const preset = spec.preset === null ? null : this.#deps.preset(spec.preset);
		if (spec.preset !== null && !preset) throw new Error(`No preset ${JSON.stringify(spec.preset)}. Pass null, or the id of a saved preset.`);
		const model = spec.model === null ? (preset?.model ?? null) : modelOfSelector(spec.model);
		if (spec.model !== null && !model) throw new Error(`model must read provider/id, such as anthropic/claude-haiku-5-5; got ${JSON.stringify(spec.model)}.`);
		const wantsBranch = spec.branch === null ? preset?.worktree !== "here" : spec.branch.toLowerCase() !== "none";
		const base = wantsBranch ? await this.#deps.checkedOut(cwd) : null;
		const name = spec.branch === null ? `${branchSlug(project.name)}/${branchSlug(spec.title)}-${this.#deps.newId().replace(/-/g, "").slice(0, 6)}` : spec.branch;
		return {
			cwd,
			prompt: spec.prompt,
			branch: base === null ? null : { kind: "new", name, base },
			model,
			thinking: spec.thinking ?? preset?.thinking ?? null,
			skill: spec.skill ?? preset?.skill ?? null,
			tools: preset?.tools ?? null,
		};
	}

	/** Starts queued worker `queued` of project `projectId`; its session leaves the queue and takes the project's next id as it attaches. */
	async #launch(projectId: string, queued: QueuedWorker): Promise<Launched> {
		const { cwd, prompt, ...options } = queued.start;
		this.#launching.set(queued.id, projectId);
		try {
			const result = await this.#deps.start(newSessionRequest(cwd, prompt, options), { kind: "new-worker", projectId, queuedId: queued.id, title: queued.title });
			if (!result.ok) throw new Error(result.error);
			// The worker took its id as it attached, before its first prompt.
			const role = this.#tracked.get(result.instanceId)?.role;
			if (role?.role !== "worker") throw new Error(`The worker started in ${result.cwd} but its session exited at once.`);
			return { workerId: role.workerId, cwd: result.cwd };
		} finally {
			this.#launching.delete(queued.id);
			// A worker that attached left the queue with `add-worker`; one that did not is still queued.
			if (this.#deps.file.apply({ op: "dequeue", id: projectId, queuedId: queued.id })) this.#deps.onChange();
		}
	}

	#now(): string {
		return new Date(this.#deps.now()).toISOString();
	}

	#rejoinOf(request: StartRequest): ProjectLaunch | null {
		switch (request.kind) {
			// Only the runner starts a new project session, and a fork belongs to no project.
			case "new":
			case "fork":
			case "replay":
				return null;
			case "resume": {
				const role = this.#deps.file.roleOf(request.sessionId);
				return role && { kind: "rejoin", role };
			}
			default: {
				const unhandled: never = request;
				return unhandled;
			}
		}
	}

	/**
	 * Live session `session` started for `launch`. Saves what is new, the project for its coordinator or the worker,
	 * which takes the project's next id, then writes the file before the session's first prompt, so omp's `projects`
	 * extension finds the session's role.
	 */
	#attach(launch: ProjectLaunch, session: { instanceId: string; sessionId: string; cwd: string }): void {
		const { file } = this.#deps;
		switch (launch.kind) {
			case "create": {
				const { projectId, name, goal } = launch;
				file.apply({ op: "create", id: projectId, name, cwd: session.cwd, at: this.#now(), coordinator: session.sessionId });
				this.#deps.seedNotes(projectId, file.get(projectId)?.name ?? name, goal);
				break;
			}
			case "new-worker":
				file.apply({ op: "add-worker", id: launch.projectId, queuedId: launch.queuedId, title: launch.title, sessionId: session.sessionId, cwd: session.cwd, at: this.#now() });
				break;
			case "rejoin":
				break;
			default: {
				const unhandled: never = launch;
				return unhandled;
			}
		}
		file.flush();
		// `null` for a worker whose project is gone.
		const role = file.roleOf(session.sessionId);
		if (!role) return;
		this.#tracked.set(session.instanceId, { role, sessionId: session.sessionId, asked: new Set() });
		this.#deps.onChange();
		this.#deliver(role.projectId);
	}

	/** Saves `bodies` as updates for project `projectId`'s coordinator. */
	#save(projectId: string, bodies: UpdateBody[]): void {
		if (bodies.length === 0) return;
		const at = this.#now();
		for (const body of bodies) this.#deps.file.apply({ op: "update", id: projectId, update: { id: this.#deps.newId(), at, ...body } });
		this.#deps.onChange();
	}

	/**
	 * Sends project `projectId`'s waiting updates to its coordinator as one prompt, once it is live and idle. They stay
	 * saved until omp takes the prompt; when it does not, the coordinator's next roster change or turn end tries again.
	 */
	#deliver(projectId: string): void {
		const project = this.#deps.file.get(projectId);
		if (!project || project.archived || project.updates.length === 0 || this.#sending.has(projectId)) return;
		const coordinator = this.#deps.bySessionId(project.coordinator.sessionId);
		if (coordinator?.status !== "idle") return;
		const updateIds = project.updates.map(update => update.id);
		this.#sending.add(projectId);
		void coordinator.prompt(updateText(project, project.updates)).then(
			() => {
				this.#sending.delete(projectId);
				if (this.#deps.file.apply({ op: "delivered", id: projectId, updateIds })) this.#deps.onChange();
				this.#deliver(projectId);
			},
			() => {
				this.#sending.delete(projectId);
			},
		);
	}
}

/** The project whose coordinator `launch` starts, which gets the project's tools; `null` for a worker. */
function coordinatedBy(launch: ProjectLaunch): string | null {
	switch (launch.kind) {
		case "create":
			return launch.projectId;
		case "new-worker":
			return null;
		case "rejoin":
			return launch.role.role === "coordinator" ? launch.role.projectId : null;
		default: {
			const unhandled: never = launch;
			return unhandled;
		}
	}
}
