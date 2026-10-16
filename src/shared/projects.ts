/**
 * Projects: a coordinator session that plans and starts worker sessions, which all share one notes directory.
 * The server keeps them in `projects.json` and is its only writer; sessions link to a project by session id.
 * omp's extension `templates/omp/agent/extensions/projects.ts` reads the file but cannot import `src/`, so it keeps its own copy of the fields it reads: change it with this one.
 */
import type { BranchChoice } from "./git";
import type { ModelOption } from "./models";
import type { HostStatus } from "./sessions";

/** `w1`, `w2`, …: numbered per project, the name the coordinator's tools and the page use. */
export type WorkerId = string;

export interface Worker {
	id: WorkerId;
	title: string;
	/** The session's current id; a `/move` or an edited prompt changes it. */
	sessionId: string;
	cwd: string;
	startedAt: string;
	/** The text the worker's last finished turn ended on, without its suggested prompts, empty when it ended on none. */
	lastReply: { at: string; text: string } | null;
}

/** News for a coordinator from outside its project: a routine's prompt, a pull request's checks, a Linear issue. */
export interface ProjectEvent {
	source: string;
	title: string;
	text: string;
	url: string | null;
}

/**
 * What the coordinator hears, kept until it reaches it: a worker finished a turn, whose reply is its `lastReply`, asks a
 * question, or stopped; the dashboard restarted with these workers stopped; or an event from a subscription.
 */
export type ProjectUpdate = { id: string; at: string } & (
	| { kind: "finished"; workerId: WorkerId }
	| { kind: "asked"; workerId: WorkerId; requestId: string; question: string }
	| { kind: "stopped"; workerId: WorkerId }
	| { kind: "restarted"; workers: WorkerId[] }
	| ({ kind: "event" } & ProjectEvent)
);

/** How a worker starts, saved while it waits for a free slot. */
export interface WorkerStart {
	cwd: string;
	prompt: string;
	branch: BranchChoice | null;
	model: ModelOption | null;
	thinking: string | null;
	skill: string | null;
	tools: string[] | null;
}

/** A worker the coordinator asked for while the project ran {@link Project.maxWorkers} busy workers. */
export interface QueuedWorker {
	id: string;
	title: string;
	at: string;
	start: WorkerStart;
}

/** Which of the viewer's assigned Linear issues a project hears about; a `null` field matches every value. */
export interface LinearFilter {
	team: string | null;
	label: string | null;
	project: string | null;
}

/** What a project's coordinator hears about on its own: its workers' pull requests, and Linear issues matching a filter, `null` for none. */
export interface ProjectWatch {
	pullRequests: boolean;
	linear: LinearFilter | null;
}

export const DEFAULT_WATCH: ProjectWatch = { pullRequests: true, linear: null };
/** How often the coordinator asks the user to review until the user says otherwise. */
export const DEFAULT_REVIEW_CADENCE = "every PR";
/** The longest review cadence the page saves. */
export const MAX_REVIEW_CADENCE = 200;

/** How many workers work at once until the user changes it. */
export const DEFAULT_MAX_WORKERS = 3;
/** The most the page lets a project run at once. */
export const MAX_MAX_WORKERS = 20;

/** Whether `value` is a worker cap the page may set. */
export const isMaxWorkers = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_MAX_WORKERS;

export interface Project {
	id: string;
	name: string;
	/** The workspace the coordinator started in, where workers start unless it names another. */
	cwd: string;
	createdAt: string;
	archived: boolean;
	coordinator: { sessionId: string };
	/** In the order they started, which is the order of their ids. */
	workers: Worker[];
	/** Waiting for the coordinator to be live and idle, oldest first; a worker's finished turn replaces its earlier one. */
	updates: ProjectUpdate[];
	/** The number the next worker's id takes. */
	nextWorker: number;
	/** How many workers may work or ask at once; more wait in {@link queue}. */
	maxWorkers: number;
	/** Workers waiting for a free slot, oldest first. */
	queue: QueuedWorker[];
	watch: ProjectWatch;
	/** When the coordinator asks the user to review a pull request, in the user's words: `every PR`, `every 5th PR`, `failures only`. */
	reviewCadence: string;
}

/** A notes file of a project or of the user, as `GET /api/project-notes` lists it. */
export interface ProjectNote {
	/** Its path from its notes directory, with `/`: `docs/testing.md`. */
	name: string;
	path: string;
	modifiedAt: string;
}

/** `GET /api/project-notes`: the project's notes and the user's, each directory with its Markdown files. */
export interface ProjectNotesAnswer {
	dir: string;
	notes: ProjectNote[];
	userDir: string;
	userNotes: ProjectNote[];
}

/** What the page shows for a worker; computed from the live sessions, never stored. */
export type WorkerPhase = "working" | "asking" | "idle" | "interrupted" | "ended";

/** A worker's phase from its live status, `null` when it does not run, and whether it stopped without End session. */
export function workerPhase(status: HostStatus | null, interrupted: boolean): WorkerPhase {
	switch (status) {
		case null:
			return interrupted ? "interrupted" : "ended";
		case "working":
			return "working";
		case "needs-input":
			return "asking";
		case "idle":
		case "unknown":
			return "idle";
		default: {
			const unhandled: never = status;
			return unhandled;
		}
	}
}

/** The name a project gets when the form leaves it empty, as Cursor does. */
export const DEFAULT_PROJECT_NAME = "New project";

/** The changes the page sends; the server makes the rest. */
export type ProjectEdit =
	| { op: "rename"; id: string; name: string }
	| { op: "archive"; id: string }
	| { op: "unarchive"; id: string }
	| { op: "max-workers"; id: string; max: number }
	| { op: "watch"; id: string; watch: ProjectWatch }
	| { op: "review-cadence"; id: string; cadence: string };

const isNullableText = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.trim() !== "");

/** A watch as the page sends it and `projects.json` keeps it; `null` for anything else. */
export function parseWatch(value: unknown): ProjectWatch | null {
	if (typeof value !== "object" || value === null) return null;
	const { pullRequests, linear } = value as Record<string, unknown>;
	if (typeof pullRequests !== "boolean") return null;
	if (linear === null) return { pullRequests, linear: null };
	if (typeof linear !== "object") return null;
	const { team, label, project } = linear as Record<string, unknown>;
	return isNullableText(team) && isNullableText(label) && isNullableText(project) ? { pullRequests, linear: { team, label, project } } : null;
}

/** `cadence` trimmed to one line, or {@link DEFAULT_REVIEW_CADENCE} when nothing is left. */
export const reviewCadence = (cadence: string): string => cadence.replace(/\s+/g, " ").trim().slice(0, MAX_REVIEW_CADENCE) || DEFAULT_REVIEW_CADENCE;

/** Whether `phase` takes one of the project's {@link Project.maxWorkers} slots. */
export const isBusy = (phase: WorkerPhase): boolean => phase === "working" || phase === "asking";
