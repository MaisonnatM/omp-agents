/**
 * Runs projects: starts each coordinator and its workers as dashboard sessions, follows the live ones by instance id,
 * and brings what workers do to their coordinator. A worker's finished turn, its question, or its stop becomes an update,
 * saved in `projects.json` until the coordinator is live and idle, then sent to it as one follow-up prompt.
 * A session's role is keyed by session id on disk, so a resumed coordinator gets its tools again.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentDir } from "../omp/config";
import { PLAIN_LAUNCH, type RpcLaunch } from "../omp/rpc";
import type { ModelOption } from "../shared/models";
import { type Project, type Worker, type WorkerId, type WorkerPhase, workerPhase } from "../shared/projects";
import { type HostStatus, newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import { type ProjectControl, projectTools, updateText } from "./project-tools";
import type { ProjectNews, ProjectRole, ProjectsFile } from "./projects-file";

/**
 * Why the runner starts a session, which the starter takes beside the request and the page never sends: a new
 * project's coordinator, a new worker, or a resumed session that rejoins the project it belongs to.
 */
export type ProjectLaunch =
	| { kind: "create"; projectId: string; name: string; goal: string }
	| { kind: "new-worker"; projectId: string; title: string }
	| { kind: "rejoin"; role: ProjectRole };

/** How a start joins its project: what omp launches with, and what links the session once it is in the registry, before its first prompt. */
export interface ProjectJoin {
	rpc: RpcLaunch;
	attach(session: { instanceId: string; sessionId: string; cwd: string }): void;
}

const NO_PROJECT: ProjectJoin = { rpc: PLAIN_LAUNCH, attach() {} };

/**
 * Loads the `projects` extension from this repository's template when `bun run omp-template` has not installed it, so a
 * project session gets its instructions either way. Never both: omp loads two copies at two paths twice.
 */
export function projectsExtensionArgs(): string[] {
	if (existsSync(join(agentDir, "extensions", "projects.ts"))) return [];
	return ["-e", join(import.meta.dir, "..", "..", "templates", "omp", "agent", "extensions", "projects.ts")];
}

/** What the runner asks of a live session. */
export interface RunnerSession {
	sessionId: string;
	status: HostStatus;
	requests: { id: string; title: string }[];
	/** Sends `text` as a follow-up while a turn runs, else as a prompt; rejects when omp does not take it. */
	prompt(text: string): Promise<void>;
}

export interface ProjectRunnerDeps {
	file: ProjectsFile;
	/** Starts `request` as a session of the project `project` names; with `null`, a resume rejoins its own project. */
	start(request: StartRequest, project: ProjectLaunch | null): Promise<StartResult>;
	/** Live session `instanceId`, or `null` once it is gone. */
	session(instanceId: string): RunnerSession | null;
	/** The live session with id `sessionId`, or `null` when none runs. */
	bySessionId(sessionId: string): RunnerSession | null;
	/** Whether past session `sessionId` stopped without End session. */
	interrupted(sessionId: string): boolean;
	/** The `omp` arguments that load the `projects` extension when omp does not already. */
	extensionArgs(): string[];
	/** Creates project `id`'s notes for a project named `name` working on `goal`. */
	seedNotes(id: string, name: string, goal: string): void;
	now(): number;
	newId(): string;
	/** The projects changed; every socket should hear them. */
	onChange(): void;
}

type WorkerRole = Extract<ProjectRole, { role: "worker" }>;

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

export class ProjectRunner implements ProjectControl {
	readonly #deps: ProjectRunnerDeps;
	readonly #tracked = new Map<string, Tracked>();
	/** Projects with an update prompt on its way to the coordinator. */
	readonly #sending = new Set<string>();
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

	/** Session `instanceId`'s row changed: a worker may ask a question, and a coordinator may have gone idle. */
	observe(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		const session = this.#deps.session(instanceId);
		if (!tracked || !session) return;
		const { role, asked } = tracked;
		if (role.role === "worker") {
			const news = session.requests.filter(request => !asked.has(request.id));
			for (const request of news) asked.add(request.id);
			this.#report(role, news.map(request => ({ kind: "asked", requestId: request.id, question: request.title })));
		}
		this.#deliver(role.projectId);
	}

	/** Session `instanceId` finished a turn that ended on `reply`. */
	turnEnded(instanceId: string, reply: string | null): void {
		const tracked = this.#tracked.get(instanceId);
		if (!tracked) return;
		const { role } = tracked;
		if (role.role === "worker") {
			this.#deps.file.apply({ op: "reply", id: role.projectId, workerId: role.workerId, reply: { at: this.#now(), text: reply ?? "" } });
			this.#report(role, [{ kind: "finished" }]);
		}
		this.#deliver(role.projectId);
	}

	/** Session `instanceId`'s process exited. */
	exited(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		if (!tracked) return;
		this.#tracked.delete(instanceId);
		const { role } = tracked;
		if (role.role !== "worker" || this.#stopping) return;
		this.#report(role, [{ kind: "stopped" }]);
		this.#deliver(role.projectId);
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

	questionsOf(worker: Worker): string[] {
		return this.#deps.bySessionId(worker.sessionId)?.requests.map(request => request.title) ?? [];
	}

	async startWorker(project: Project, spec: { title: string; prompt: string; cwd: string | null }): Promise<{ workerId: WorkerId; cwd: string }> {
		const { cwd } = spec;
		// `~` stays for the starter, which reads it as the home directory; any other relative directory is the workspace's.
		const dir = cwd === null ? project.cwd : cwd === "~" || cwd.startsWith("~/") ? cwd : resolve(project.cwd, cwd);
		const result = await this.#deps.start(newSessionRequest(dir, spec.prompt), { kind: "new-worker", projectId: project.id, title: spec.title });
		if (!result.ok) throw new Error(result.error);
		// The worker took its id as it attached, before its first prompt.
		const role = this.#tracked.get(result.instanceId)?.role;
		if (role?.role !== "worker") throw new Error(`The worker started in ${result.cwd} but its session exited at once.`);
		return { workerId: role.workerId, cwd: result.cwd };
	}

	async messageWorker(worker: Worker, text: string): Promise<void> {
		let session = this.#deps.bySessionId(worker.sessionId);
		if (!session) {
			const result = await this.#deps.start({ kind: "resume", sessionId: worker.sessionId }, null);
			if (!result.ok) throw new Error(`Cannot resume ${worker.id}: ${result.error}`);
			session = this.#deps.session(result.instanceId);
			if (!session) throw new Error(`${worker.id} exited as it resumed.`);
		}
		await session.prompt(text);
	}

	#now(): string {
		return new Date(this.#deps.now()).toISOString();
	}

	#rejoinOf(request: StartRequest): ProjectLaunch | null {
		switch (request.kind) {
			// Only the runner starts a new project session, and a fork belongs to no project.
			case "new":
			case "fork":
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
				file.apply({ op: "add-worker", id: launch.projectId, title: launch.title, sessionId: session.sessionId, cwd: session.cwd, at: this.#now() });
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

	/** Saves `news` of worker `role` for its coordinator. */
	#report(role: WorkerRole, news: ProjectNews[]): void {
		if (news.length === 0) return;
		const at = this.#now();
		for (const item of news) this.#deps.file.apply({ op: "update", id: role.projectId, update: { id: this.#deps.newId(), workerId: role.workerId, at, ...item } });
		this.#deps.onChange();
	}

	/**
	 * Sends project `projectId`'s waiting updates to its coordinator as one prompt, once it is live and idle. They stay
	 * saved until omp takes the prompt; when it does not, the coordinator's next roster change or turn end tries again.
	 */
	#deliver(projectId: string): void {
		const project = this.#deps.file.get(projectId);
		if (!project || project.updates.length === 0 || this.#sending.has(projectId)) return;
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
