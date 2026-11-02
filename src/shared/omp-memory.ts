/** Settings › omp memory: what omp itself recalls across sessions of a workspace, and the edits the section sends. */
import type { OmpFile } from "./models";

/** The stores omp's memory setting picks between; `off` keeps nothing. */
export const OMP_MEMORY_BACKENDS = ["off", "local", "hindsight", "mnemopi", "sharpshooter"] as const;
export type OmpMemoryBackendId = (typeof OMP_MEMORY_BACKENDS)[number];

/** The layer a session takes a setting from: an environment variable, the workspace's config, the user's `config.yml`, or omp's default. */
export type OmpMemorySource = { layer: "env"; variable: string } | { layer: "workspace" | "user" | "default" };

/** One setting this section edits, as a session in the workspace reads it. */
export interface OmpMemorySetting<T> {
	value: T;
	source: OmpMemorySource;
	/** The value in the user's `config.yml`, `null` when it holds none: what a save's `expected` must equal. */
	user: T | null;
}

/** A backend the picker offers, in omp's own words. */
export interface OmpMemoryBackendOption {
	value: OmpMemoryBackendId;
	label: string;
	description: string;
}

/** Which part of the Local store a file is: lessons the agent learned, the summary, a skill, or one session's summary. */
export type OmpMemoryFileGroup = "lessons" | "summary" | "skills" | "rollouts" | "decisions";

/** A file of a file backend; `name` is its path within the store. */
export interface OmpMemoryFile extends Pick<OmpFile, "path" | "pathDisplay" | "body"> {
	group: OmpMemoryFileGroup;
	name: string;
}

/** What can be done to one entry; omp refuses the others. */
export type OmpMemoryEntryOp = "update" | "forget" | "retire";

/** One row of a row backend. `kind` is the table it lives in, `remote` for a Hindsight memory. */
export interface OmpMemoryEntry {
	id: string;
	bank: string;
	content: string;
	/** When omp stored it, as the store wrote it; `null` when it says nothing. */
	at: string | null;
	kind: "working" | "episodic" | "fact" | "remote";
	/** Empty for a read-only entry. */
	ops: OmpMemoryEntryOp[];
}

/** The rows of a row backend, newest first, or why they could not be read. `truncated`: more rows than the page lists. */
export type OmpMemoryRows = { entries: OmpMemoryEntry[]; truncated: boolean } | { error: string };

/**
 * The store of the backend in effect, in its own shape: files stay files, rows stay rows. Mnemopi's `sharedBank` is the
 * one of its `banks` every workspace reads, `null` for none; Hindsight's `shared` says its one bank is read by every workspace.
 */
export type OmpMemoryStore =
	| { backend: "off" }
	| { backend: "local"; files: OmpMemoryFile[] }
	/** `queued`: sessions waiting for the background pass that rewrites the files. */
	| { backend: "sharpshooter"; files: OmpMemoryFile[]; queued: number }
	| ({ backend: "mnemopi"; banks: string[]; sharedBank: string | null } & OmpMemoryRows)
	| ({ backend: "hindsight"; bank: string; shared: boolean } & OmpMemoryRows);

/** One workspace's memory: what a new session gets, and the store it comes from. */
export interface OmpMemoryWorkspace {
	/** The memory block a new session's system prompt gets; `partial` when the session adds more as it runs. `null`: none. */
	preview: { text: string; partial: boolean } | null;
	store: OmpMemoryStore;
}

/** `GET /api/omp-memory[?cwd=<dir>]`. */
export interface OmpMemory {
	backend: OmpMemorySetting<OmpMemoryBackendId> & { options: OmpMemoryBackendOption[] };
	autolearn: { enabled: OmpMemorySetting<boolean>; autoContinue: OmpMemorySetting<boolean> };
	/** `null` without a workspace: omp keeps memory per workspace. */
	workspace: OmpMemoryWorkspace | null;
}

/** `PUT /api/omp-memory/entry`. `expected` is the content the page showed; a row that changed since is not touched. */
export type OmpMemoryEntryEdit = { bank: string; id: string; expected: string } & ({ op: "update"; content: string } | { op: "forget" | "retire" });

/** `PUT /api/omp-memory/clear`: forgets the store of `backend`, which must still be the one in effect. */
export interface OmpMemoryClear {
	backend: OmpMemoryBackendId;
}
