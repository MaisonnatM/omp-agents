/**
 * The projects, saved in `projects.json` as `{ projects }`, and the changes the server makes to them. The server is the
 * only writer; omp's `projects` extension reads the file to find the project and role of its session, so a link is
 * flushed before the session's first prompt.
 */
import { JsonFile } from "../fs";
import { isObject, parseAll } from "../json";
import { DEFAULT_PROJECT_NAME, type Project, type ProjectEdit, type ProjectUpdate, type Worker, type WorkerId } from "../shared/projects";

/** A session's place in a project. */
export type ProjectRole = { projectId: string; role: "coordinator" } | { projectId: string; role: "worker"; workerId: WorkerId };

/** What a worker tells its coordinator, before it is saved as a {@link ProjectUpdate}. */
export type ProjectNews = { kind: "finished" } | { kind: "asked"; requestId: string; question: string } | { kind: "stopped" };

/** The changes the project runner makes; the page makes only {@link ProjectEdit}s. */
type RunnerChange =
	/** A new project whose coordinator already runs as `coordinator`. */
	| { op: "create"; id: string; name: string; cwd: string; at: string; coordinator: string }
	/** A worker that already runs as `sessionId`, which takes the project's next worker id. */
	| { op: "add-worker"; id: string; title: string; sessionId: string; cwd: string; at: string }
	/** Session `from` of any project now goes by `to`, after a `/move` or an edited prompt. */
	| { op: "relink"; from: string; to: string }
	| { op: "reply"; id: string; workerId: WorkerId; reply: { at: string; text: string } }
	| { op: "update"; id: string; update: ProjectUpdate }
	/** The updates `updateIds` reached the coordinator. */
	| { op: "delivered"; id: string; updateIds: string[] };

export type ProjectChange = ProjectEdit | RunnerChange;

/** `name` trimmed to one line, or {@link DEFAULT_PROJECT_NAME} when nothing is left. */
export const projectName = (name: string): string => name.replace(/\s+/g, " ").trim() || DEFAULT_PROJECT_NAME;

function editProject(projects: Project[], id: string, edit: (project: Project) => Project): Project[] {
	const index = projects.findIndex(project => project.id === id);
	if (index < 0) return projects;
	const project = projects[index]!;
	const next = edit(project);
	return next === project ? projects : projects.with(index, next);
}

/** `projects` after `change`, or `projects` itself when it changes nothing. */
export function applyProject(projects: Project[], change: ProjectChange): Project[] {
	switch (change.op) {
		case "create": {
			const { id, name, cwd, at, coordinator } = change;
			if (projects.some(project => project.id === id)) return projects;
			return [...projects, { id, name: projectName(name), cwd, createdAt: at, archived: false, coordinator: { sessionId: coordinator }, workers: [], updates: [], nextWorker: 1 }];
		}
		case "rename": {
			const name = projectName(change.name);
			return editProject(projects, change.id, project => (project.name === name ? project : { ...project, name }));
		}
		case "archive":
			return editProject(projects, change.id, project => (project.archived ? project : { ...project, archived: true }));
		case "add-worker": {
			const { title, sessionId, cwd, at } = change;
			return editProject(projects, change.id, project => {
				if (project.workers.some(worker => worker.sessionId === sessionId)) return project;
				const worker: Worker = { id: `w${project.nextWorker}`, title, sessionId, cwd, startedAt: at, lastReply: null };
				return { ...project, workers: [...project.workers, worker], nextWorker: project.nextWorker + 1 };
			});
		}
		case "relink": {
			const { from, to } = change;
			if (from === to) return projects;
			let changed = false;
			const next = projects.map(project => {
				const coordinator = project.coordinator.sessionId === from ? { sessionId: to } : project.coordinator;
				const workers = project.workers.map(worker => (worker.sessionId === from ? { ...worker, sessionId: to } : worker));
				if (coordinator === project.coordinator && workers.every((worker, i) => worker === project.workers[i])) return project;
				changed = true;
				return { ...project, coordinator, workers };
			});
			return changed ? next : projects;
		}
		case "reply": {
			const { workerId, reply } = change;
			return editProject(projects, change.id, project => {
				if (!project.workers.some(worker => worker.id === workerId)) return project;
				return { ...project, workers: project.workers.map(worker => (worker.id === workerId ? { ...worker, lastReply: reply } : worker)) };
			});
		}
		case "update": {
			const { update } = change;
			return editProject(projects, change.id, project => {
				if (project.updates.some(u => u.id === update.id)) return project;
				// The coordinator reads a finished turn as the worker's last reply, so only the latest one waits.
				const kept = update.kind === "finished" ? project.updates.filter(u => u.kind !== "finished" || u.workerId !== update.workerId) : project.updates;
				return { ...project, updates: [...kept, update] };
			});
		}
		case "delivered": {
			const ids = new Set(change.updateIds);
			return editProject(projects, change.id, project => {
				const updates = project.updates.filter(update => !ids.has(update.id));
				return updates.length === project.updates.length ? project : { ...project, updates };
			});
		}
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

interface Stored {
	projects: Project[];
}

const isText = (value: unknown): value is string => typeof value === "string";

function parseWorker(value: unknown): Worker | null {
	if (!isObject(value)) return null;
	const { id, title, sessionId, cwd, startedAt, lastReply } = value;
	if (!isText(id) || !isText(title) || !isText(sessionId) || !isText(cwd) || !isText(startedAt)) return null;
	if (lastReply === null) return { id, title, sessionId, cwd, startedAt, lastReply: null };
	if (!isObject(lastReply) || !isText(lastReply.at) || !isText(lastReply.text)) return null;
	return { id, title, sessionId, cwd, startedAt, lastReply: { at: lastReply.at, text: lastReply.text } };
}

function parseUpdate(value: unknown): ProjectUpdate | null {
	if (!isObject(value)) return null;
	const { id, workerId, at, kind } = value;
	if (!isText(id) || !isText(workerId) || !isText(at)) return null;
	switch (kind) {
		case "finished":
		case "stopped":
			return { id, workerId, at, kind };
		case "asked":
			return isText(value.requestId) && isText(value.question) ? { id, workerId, at, kind, requestId: value.requestId, question: value.question } : null;
		default:
			return null;
	}
}

function parseProject(value: unknown): Project | null {
	if (!isObject(value)) return null;
	const { id, name, cwd, createdAt, archived, coordinator, nextWorker } = value;
	if (!isText(id) || !isText(name) || !isText(cwd) || !isText(createdAt) || typeof archived !== "boolean") return null;
	if (!isObject(coordinator) || !isText(coordinator.sessionId) || typeof nextWorker !== "number" || !Number.isSafeInteger(nextWorker)) return null;
	const workers = parseAll(value.workers, parseWorker);
	const updates = parseAll(value.updates, parseUpdate);
	if (!workers || !updates) return null;
	return { id, name, cwd, createdAt, archived, coordinator: { sessionId: coordinator.sessionId }, workers, updates, nextWorker };
}

export function parseProjects(value: unknown): Stored | null {
	if (!isObject(value)) return null;
	const projects = parseAll(value.projects, parseProject);
	return projects ? { projects } : null;
}

export class ProjectsFile {
	readonly #file: JsonFile<Stored>;
	#projects: Project[];

	constructor(path: string) {
		this.#file = new JsonFile(path, { parse: parseProjects, holds: "a list of projects", onInvalid: "aside", indent: "\t" });
		this.#projects = this.#file.load()?.projects ?? [];
	}

	get projects(): Project[] {
		return this.#projects;
	}

	get(id: string): Project | undefined {
		return this.#projects.find(project => project.id === id);
	}

	/** The project and role of session `sessionId`, or `null` when it belongs to none. */
	roleOf(sessionId: string): ProjectRole | null {
		for (const project of this.#projects) {
			if (project.coordinator.sessionId === sessionId) return { projectId: project.id, role: "coordinator" };
			const worker = project.workers.find(candidate => candidate.sessionId === sessionId);
			if (worker) return { projectId: project.id, role: "worker", workerId: worker.id };
		}
		return null;
	}

	/**
	 * Applies `change` to the file as it is now and saves; whether it changed anything. Every server runs its own runner,
	 * so the file is read first: a change made beside another server keeps what that server saved.
	 */
	apply(change: ProjectChange): boolean {
		const current = this.#file.load()?.projects ?? this.#projects;
		const next = applyProject(current, change);
		this.#projects = next;
		if (next === current) return false;
		this.#file.save({ projects: next });
		return true;
	}

	/** Writes what {@link apply} saved now, for a session about to read the file. */
	flush(): void {
		this.#file.flush();
	}

	/** Reads the file again, for what the server that ran before this one saved. */
	reload(): void {
		this.#projects = this.#file.load()?.projects ?? [];
	}
}
