/** Settings › omp memory: what omp itself recalls across sessions of a workspace, and the edits the section sends. */
import type { OmpFile } from "./models";

/** The omp settings Settings › omp memory edits; Settings › omp settings links here for them. */
export const OMP_MEMORY_SETTINGS = { backend: "memory.backend", autolearn: "autolearn.enabled", autoContinue: "autolearn.autoContinue" } as const;

/** The stores the page can forget at once; Hindsight's lives on its server. */
export const OMP_MEMORY_CLEARABLE = ["local", "sharpshooter", "mnemopi"] as const;
export type OmpMemoryClearable = (typeof OMP_MEMORY_CLEARABLE)[number];
export const isOmpMemoryClearable = (value: unknown): value is OmpMemoryClearable => OMP_MEMORY_CLEARABLE.some(backend => backend === value);

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

/** `GET /api/omp-memory?cwd=<dir>`: what a new session in the workspace gets, and the store it comes from. */
export interface OmpMemory {
	/** The memory block a new session's system prompt gets; `partial` when the session adds more as it runs. `null`: none. */
	preview: { text: string; partial: boolean } | null;
	store: OmpMemoryStore;
}

/** `PUT /api/omp-memory/entry`. `expected` is the content the page showed; a row that changed since is not touched. */
export type OmpMemoryEntryEdit = { bank: string; id: string; expected: string } & ({ op: "update"; content: string } | { op: "forget" | "retire" });

/** `PUT /api/omp-memory/clear`: forgets the store of `backend`, which must still be the one in effect. */
export interface OmpMemoryClear {
	backend: OmpMemoryClearable;
}
