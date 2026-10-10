/** The directories Settings → Workspaces added and hid, saved in `workspaces.json`. */
import { linkSync, readFileSync, unlinkSync } from "node:fs";
import { JsonFile } from "../fs";
import { errorText, isObject } from "../json";
import { applyWorkspace, NO_WORKSPACES, type WorkspaceChange, type WorkspaceList } from "../shared/workspaces";

const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string" && entry.startsWith("/"));

export function parseWorkspaces(value: unknown): WorkspaceList | null {
	if (!isObject(value) || !isPaths(value.added) || !isPaths(value.hidden)) return null;
	return { added: value.added, hidden: value.hidden };
}

/** Whether the file at `path` holds a workspace list; `false` when it is missing, unreadable, or holds anything else. */
function holdsWorkspaces(path: string): boolean {
	try {
		return parseWorkspaces(JSON.parse(readFileSync(path, "utf8"))) !== null;
	} catch {
		return false;
	}
}

/**
 * Moves `oldPath`, where an older version saved the list, to `path`, when it holds a workspace list; a file there in any
 * other shape is not this list and stays. Linking then unlinking never replaces `path`, which a server beside this one may
 * have written: when `path` exists the old file stays, and when another server moved it first there is nothing to move.
 */
function adoptOldFile(oldPath: string, path: string): void {
	if (!holdsWorkspaces(oldPath)) return;
	try {
		linkSync(oldPath, path);
		unlinkSync(oldPath);
	} catch (err) {
		if (isObject(err) && (err.code === "EEXIST" || err.code === "ENOENT")) return;
		console.error(`omp-agents: cannot move ${oldPath}: ${errorText(err)}`);
	}
}

export class WorkspacesFile {
	readonly #file: JsonFile<WorkspaceList>;
	#list: WorkspaceList;

	/** `oldPath` is where an older version saved the list; it becomes `path` before the list loads. */
	constructor(path: string, oldPath: string) {
		adoptOldFile(oldPath, path);
		// Someone may have edited the file by hand, so one that holds something else moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseWorkspaces, holds: "a workspace list", onInvalid: "aside", indent: "\t" });
		this.#list = this.#file.load() ?? NO_WORKSPACES;
	}

	get list(): WorkspaceList {
		return this.#list;
	}

	/** Applies `change` and saves; whether it changed anything. */
	apply(change: WorkspaceChange): boolean {
		const next = applyWorkspace(this.#list, change);
		if (next === this.#list) return false;
		this.#list = next;
		this.#file.save(next);
		return true;
	}
}
