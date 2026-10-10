/**
 * Projects: a coordinator session that plans and starts worker sessions, which all share one notes directory.
 * The server keeps them in `projects.json` and is its only writer; sessions link to a project by session id.
 */
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

/** What the coordinator hears about a worker, kept until it reaches it: the worker finished a turn, whose reply is its `lastReply`, asks the user a question, or stopped. */
export type ProjectUpdate = { id: string; workerId: WorkerId; at: string } & ({ kind: "finished" } | { kind: "asked"; requestId: string; question: string } | { kind: "stopped" });

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
}

/** A notes file of a project, as `GET /api/project-notes` lists it. */
export interface ProjectNote {
	name: string;
	path: string;
	modifiedAt: string;
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
export type ProjectEdit = { op: "rename"; id: string; name: string } | { op: "archive"; id: string };
