/** The directories Settings → Workspaces added, hid, and placed in the Personal space, saved in `workspaces.json`. */
import { linkSync, readFileSync, unlinkSync } from "node:fs";
import { ReducerFile } from "../fs";
import { errorText, isObject } from "../json";
import { applyWorkspace, NO_WORKSPACES, type WorkspaceChange, type WorkspaceList } from "../shared/workspaces";

const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string" && entry.startsWith("/"));

/** The list `value` holds; a file an older version wrote has no `personal`, so every workspace in it is Work. */
export function parseWorkspaces(value: unknown): WorkspaceList | null {
	if (!isObject(value) || !isPaths(value.added) || !isPaths(value.hidden)) return null;
	const personal = value.personal ?? [];
	return isPaths(personal) ? { added: value.added, hidden: value.hidden, personal } : null;
}

/** The list the file at `path` holds; `null` when it is missing, unreadable, or holds anything else. */
export function readWorkspaces(path: string): WorkspaceList | null {
	try {
		return parseWorkspaces(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return null;
	}
}

/**
 * Moves `oldPath`, where an older version saved the list, to `path`, when it holds a workspace list; a file there in any
 * other shape is not this list and stays. Linking then unlinking never replaces `path`, which a server beside this one may
 * have written: when `path` exists the old file stays, and when another server moved it first there is nothing to move.
 * Runs before anything reads either file.
 */
export function adoptOldWorkspaces(oldPath: string, path: string): void {
	if (readWorkspaces(oldPath) === null) return;
	try {
		linkSync(oldPath, path);
		unlinkSync(oldPath);
	} catch (err) {
		if (isObject(err) && (err.code === "EEXIST" || err.code === "ENOENT")) return;
		console.error(`omp-agents: cannot move ${oldPath}: ${errorText(err)}`);
	}
}

export class WorkspacesFile extends ReducerFile<WorkspaceList, [WorkspaceChange]> {
	constructor(path: string) {
		super(path, { parse: parseWorkspaces, holds: "a workspace list", empty: NO_WORKSPACES, reduce: applyWorkspace });
	}
}
