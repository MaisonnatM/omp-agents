/**
 * The projects, saved in `projects.json` as `{ projects }`, and the changes the server makes to them. The server is the
 * only writer; omp's `projects` extension reads the file to find the project and role of its session, so a link is
 * flushed before the session's first prompt.
 */
import { ReducerFile } from "../fs";
import { isObject, parseAll } from "../json";
import { parseBranchChoice, parseModel, parseSkill, parseThinking } from "../shared/sessions";
import {
	DEFAULT_MAX_WORKERS,
	DEFAULT_PROJECT_NAME,
	DEFAULT_REVIEW_CADENCE,
	DEFAULT_WATCH,
	isMaxWorkers,
	type Project,
	type ProjectEdit,
	type ProjectUpdate,
	type QueuedWorker,
	parseWatch,
	reviewCadence,
	type Worker,
	type WorkerId,
	type WorkerStart,
} from "../shared/projects";

/** A session's place in a project. */
export type ProjectRole = { projectId: string; role: "coordinator" } | { projectId: string; role: "worker"; workerId: WorkerId };

/** A {@link ProjectUpdate} before it gets its id and time. */
export type UpdateBody = BodyOf<ProjectUpdate>;
type BodyOf<U> = U extends unknown ? Omit<U, "id" | "at"> : never;

/** The changes the project runner makes; the page makes only {@link ProjectEdit}s. */
type RunnerChange =
	/** A new project whose coordinator already runs as `coordinator`. */
	| { op: "create"; id: string; name: string; cwd: string; at: string; coordinator: string }
	/** Queued worker `queuedId` runs as `sessionId`: it leaves the queue and takes the project's next worker id. */
	| { op: "add-worker"; id: string; queuedId: string; title: string; sessionId: string; cwd: string; at: string }
	/** Session `from` of any project now goes by `to`, after a `/move` or an edited prompt. */
	| { op: "relink"; from: string; to: string }
	| { op: "reply"; id: string; workerId: WorkerId; reply: { at: string; text: string } }
	| { op: "update"; id: string; update: ProjectUpdate }
	/** The updates `updateIds` reached the coordinator. */
	| { op: "delivered"; id: string; updateIds: string[] }
	| { op: "enqueue"; id: string; worker: QueuedWorker }
	/** Queued worker `queuedId` failed to start. */
	| { op: "dequeue"; id: string; queuedId: string };

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
			return [
				...projects,
				{ id, name: projectName(name), cwd, createdAt: at, archived: false, coordinator: { sessionId: coordinator }, workers: [], updates: [], nextWorker: 1, maxWorkers: DEFAULT_MAX_WORKERS, queue: [], watch: DEFAULT_WATCH, reviewCadence: DEFAULT_REVIEW_CADENCE },
			];
		}
		case "max-workers": {
			const { max } = change;
			if (!isMaxWorkers(max)) return projects;
			return editProject(projects, change.id, project => (project.maxWorkers === max ? project : { ...project, maxWorkers: max }));
		}
		case "enqueue": {
			const { worker } = change;
			return editProject(projects, change.id, project => (project.queue.some(queued => queued.id === worker.id) ? project : { ...project, queue: [...project.queue, worker] }));
		}
		case "dequeue": {
			const { queuedId } = change;
			return editProject(projects, change.id, project => {
				const queue = project.queue.filter(queued => queued.id !== queuedId);
				return queue.length === project.queue.length ? project : { ...project, queue };
			});
		}
		case "rename": {
			const name = projectName(change.name);
			return editProject(projects, change.id, project => (project.name === name ? project : { ...project, name }));
		}
		case "archive":
			return editProject(projects, change.id, project => (project.archived ? project : { ...project, archived: true }));
		case "unarchive":
			return editProject(projects, change.id, project => (project.archived ? { ...project, archived: false } : project));
		case "watch": {
			const { watch } = change;
			const { pullRequests, linear } = watch;
			return editProject(projects, change.id, project => {
				const before = project.watch;
				const sameLinear = before.linear === null || linear === null ? before.linear === linear : before.linear.team === linear.team && before.linear.label === linear.label && before.linear.project === linear.project;
				return before.pullRequests === pullRequests && sameLinear ? project : { ...project, watch };
			});
		}
		case "review-cadence": {
			const cadence = reviewCadence(change.cadence);
			return editProject(projects, change.id, project => (project.reviewCadence === cadence ? project : { ...project, reviewCadence: cadence }));
		}
		case "add-worker": {
			const { queuedId, title, sessionId, cwd, at } = change;
			return editProject(projects, change.id, project => {
				if (project.workers.some(worker => worker.sessionId === sessionId)) return project;
				const worker: Worker = { id: `w${project.nextWorker}`, title, sessionId, cwd, startedAt: at, lastReply: null };
				const queue = project.queue.filter(queued => queued.id !== queuedId);
				return { ...project, workers: [...project.workers, worker], nextWorker: project.nextWorker + 1, queue };
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
	if (!isText(id) || !isText(at)) return null;
	switch (kind) {
		case "finished":
		case "stopped":
			return isText(workerId) ? { id, workerId, at, kind } : null;
		case "asked":
			return isText(workerId) && isText(value.requestId) && isText(value.question) ? { id, workerId, at, kind, requestId: value.requestId, question: value.question } : null;
		case "restarted":
			return Array.isArray(value.workers) && value.workers.every(isText) ? { id, at, kind, workers: value.workers } : null;
		case "event": {
			const { source, title, text, url } = value;
			return isText(source) && isText(title) && isText(text) && (url === null || isText(url)) ? { id, at, kind, source, title, text, url } : null;
		}
		default:
			return null;
	}
}

function parseWorkerStart(value: unknown): WorkerStart | null {
	if (!isObject(value) || !isText(value.cwd) || !isText(value.prompt)) return null;
	const branch = parseBranchChoice(value.branch);
	const model = value.model === null ? { ok: null } : parseModel(value.model);
	const thinking = parseThinking(value.thinking);
	const skill = parseSkill(value.skill);
	if (!branch || !model || !thinking || !skill) return null;
	return { cwd: value.cwd, prompt: value.prompt, branch: branch.ok, model: model.ok, thinking: thinking.ok, skill: skill.ok };
}

function parseQueued(value: unknown): QueuedWorker | null {
	if (!isObject(value) || !isText(value.id) || !isText(value.title) || !isText(value.at)) return null;
	const start = parseWorkerStart(value.start);
	return start && { id: value.id, title: value.title, at: value.at, start };
}

function parseProject(value: unknown): Project | null {
	if (!isObject(value)) return null;
	const { id, name, cwd, createdAt, archived, coordinator, nextWorker, maxWorkers = DEFAULT_MAX_WORKERS, reviewCadence: cadence = DEFAULT_REVIEW_CADENCE } = value;
	if (!isText(id) || !isText(name) || !isText(cwd) || !isText(createdAt) || typeof archived !== "boolean") return null;
	if (!isObject(coordinator) || !isText(coordinator.sessionId) || typeof nextWorker !== "number" || !Number.isSafeInteger(nextWorker)) return null;
	const watch = value.watch === undefined ? DEFAULT_WATCH : parseWatch(value.watch);
	if (!isMaxWorkers(maxWorkers) || !watch || !isText(cadence)) return null;
	const workers = parseAll(value.workers, parseWorker);
	const updates = parseAll(value.updates, parseUpdate);
	const queue = value.queue === undefined ? [] : parseAll(value.queue, parseQueued);
	if (!workers || !updates || !queue) return null;
	return { id, name, cwd, createdAt, archived, coordinator: { sessionId: coordinator.sessionId }, workers, updates, nextWorker, maxWorkers, queue, watch, reviewCadence: reviewCadence(cadence) };
}

export function parseProjects(value: unknown): Project[] | null {
	return isObject(value) ? parseAll(value.projects, parseProject) : null;
}

/**
 * Every server runs its own runner, so the file is shared: a change applies to the file as it is now, and keeps what
 * a server beside this one saved.
 */
export class ProjectsFile extends ReducerFile<Project[], [ProjectChange]> {
	constructor(path: string) {
		super(path, { parse: parseProjects, toJson: projects => ({ projects }), holds: "a list of projects", empty: [], reduce: applyProject, shared: true });
	}

	get(id: string): Project | undefined {
		return this.value.find(project => project.id === id);
	}

	/** The project and role of session `sessionId`, or `null` when it belongs to none. */
	roleOf(sessionId: string): ProjectRole | null {
		for (const project of this.value) {
			if (project.coordinator.sessionId === sessionId) return { projectId: project.id, role: "coordinator" };
			const worker = project.workers.find(candidate => candidate.sessionId === sessionId);
			if (worker) return { projectId: project.id, role: "worker", workerId: worker.id };
		}
		return null;
	}
}
