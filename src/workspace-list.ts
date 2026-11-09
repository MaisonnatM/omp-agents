/** Reading `workspaces.json`, the Settings › Workspaces list: the server's `WorkspacesFile` keeps it, and the personal extension reads it each turn. */
import { readFileSync } from "node:fs";
import { isObject } from "./json";
import type { WorkspaceList } from "./shared/workspaces";

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
