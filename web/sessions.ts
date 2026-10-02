/** What the roster and past-session lists say about where sessions ran. */
import type { PastSession, RosterHost, View } from "../src/shared";

/**
 * Where a new session starts unless the user picks another directory: the open session's,
 * else the newest live one's, else the newest past one's, each only from `project` when one is selected.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], project: string | null): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const rows = [open, ...hosts.toSorted((a, b) => b.startedAt - a.startedAt), ...past];
	// Sessions from old omp versions recorded no directory.
	const chosen = rows.find(row => row?.cwdDisplay && (project === null || row.cwd === project));
	return chosen?.cwdDisplay ?? "~";
}

/** Directories sessions ran in, live ones first, then past ones newest first. The settings page reads a workspace from one. */
export function workspaces(hosts: RosterHost[], past: PastSession[]): { cwd: string; cwdDisplay: string }[] {
	const byCwd = new Map<string, string>();
	for (const row of [...hosts.toSorted((a, b) => b.startedAt - a.startedAt), ...past]) {
		// Sessions from old omp versions recorded no directory.
		if (row.cwd && !byCwd.has(row.cwd)) byCwd.set(row.cwd, row.cwdDisplay);
	}
	return [...byCwd].map(([cwd, cwdDisplay]) => ({ cwd, cwdDisplay }));
}
