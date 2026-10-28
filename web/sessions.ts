/** What the roster and past-session lists say about where sessions ran, and what they work on. */
import { newestPastFirst, type PastSession, type RosterHost, type View, type WorkItem, worksOn } from "../src/shared/sessions";
import type { Workspace } from "../src/shared/workspaces";
import { everyWord } from "../src/shared/every-word";

// `/var/folders` holds macOS's per-user `$TMPDIR`, where `mktemp -d` puts its directories.
const HIDDEN_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

/** A working directory outside the temp roots in `HIDDEN_ROOTS`, including their descendants, and not one Settings → Workspaces hid. */
export function discoverableCwd(cwd: string, hidden: ReadonlySet<string>): boolean {
	return !hidden.has(cwd) && !HIDDEN_ROOTS.some(root => cwd === root || cwd.startsWith(`${root}/`));
}

/** The running sessions that work on `item`: their tool calls named it, or a quick action on it started them. */
export const sessionsOn = (item: WorkItem, hosts: RosterHost[]): RosterHost[] => hosts.filter(host => worksOn(host, item));

/** The sessions the sidebar, the palette, and the pages list: none in a temporary or hidden directory, and none that is a Bot's conversation, which only its Bot's page shows. */
export function discoverableSessions(
	hosts: RosterHost[],
	past: PastSession[],
	hidden: ReadonlySet<string>,
	botSessions: ReadonlySet<string>,
): { hosts: RosterHost[]; past: PastSession[] } {
	const listed = <T extends { cwd: string; sessionId: string }>(rows: T[]): T[] =>
		rows.filter(row => discoverableCwd(row.cwd, hidden) && !botSessions.has(row.sessionId));
	return { hosts: listed(hosts), past: listed(past) };
}

/** The workspace a started or picked session switches to, so it stays listed. `null` keeps the current workspace; a temporary or hidden directory is not a switch. */
export function workspaceSwitch(workspace: string | null, cwd: string, hidden: ReadonlySet<string>): string | null {
	if (workspace === null || cwd === workspace || !discoverableCwd(cwd, hidden)) return null;
	return cwd;
}

const newestFirst = (a: RosterHost, b: RosterHost): number => b.startedAt - a.startedAt;

/**
 * The session the focused pane follows a picked workspace into: its most recently started running one, unless the pane
 * already shows a session from `cwd`. `null` for All workspaces, or when no session runs there.
 */
export function workspaceSession(cwd: string | null, hosts: RosterHost[], shownCwd: string | undefined): View | null {
	if (cwd === null || shownCwd === cwd) return null;
	const newest = hosts.filter(host => host.cwd === cwd).toSorted(newestFirst)[0];
	return newest ? { kind: "live", instanceId: newest.instanceId, agentId: null } : null;
}

/**
 * Where a new session starts unless the user picks another directory: the open session's,
 * else the newest live one's, else the newest past one's, each only from `workspace` when one is selected.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], workspace: string | null): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const rows = [open, ...hosts.toSorted(newestFirst), ...past];
	// Sessions from old omp versions recorded no directory.
	const chosen = rows.find(row => row?.cwdDisplay && (workspace === null || row.cwd === workspace));
	return chosen?.cwdDisplay ?? "~";
}

/** Directories sessions ran in, live ones first, then past ones newest first, then the ones Settings → Workspaces added. The settings page reads a workspace from one. */
export function listWorkspaces(hosts: RosterHost[], past: PastSession[], added: readonly Workspace[]): Workspace[] {
	const byCwd = new Map<string, string>();
	for (const row of [...hosts.toSorted(newestFirst), ...past, ...added]) {
		// Sessions from old omp versions recorded no directory.
		if (row.cwd && !byCwd.has(row.cwd)) byCwd.set(row.cwd, row.cwdDisplay);
	}
	return [...byCwd].map(([cwd, cwdDisplay]) => ({ cwd, cwdDisplay }));
}

/** The sessions tab's lists, each only from `workspace` when one is selected. A pinned session leaves its own list for `pinned`. */
export interface SidebarSessions {
	/** Pinned running sessions, then pinned past ones, interrupted first. */
	pinned: { hosts: RosterHost[]; past: PastSession[] };
	/** Live sessions whose turn runs, or that wait on a question. */
	running: RosterHost[];
	/** Live sessions that finished their turn: the blue dot. */
	idle: RosterHost[];
	interrupted: PastSession[];
	ended: PastSession[];
}

export function sidebarSessions(hosts: RosterHost[], past: PastSession[], workspace: string | null, pinned: ReadonlySet<string>): SidebarSessions {
	const listed = (row: { cwd: string }): boolean => workspace === null || row.cwd === workspace;
	const isPinned = (row: { sessionId: string }): boolean => pinned.has(row.sessionId);
	const shownHosts = hosts.filter(listed);
	const unpinnedHosts = shownHosts.filter(host => !isPinned(host));
	const shownPast = past.filter(listed);
	return {
		pinned: {
			hosts: shownHosts.filter(isPinned),
			past: shownPast.filter(isPinned).toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted)),
		},
		running: unpinnedHosts.filter(host => host.status !== "idle"),
		idle: unpinnedHosts.filter(host => host.status === "idle"),
		interrupted: shownPast.filter(session => session.interrupted && !isPinned(session)),
		ended: shownPast.filter(session => !session.interrupted && !isPinned(session)),
	};
}

/** `lists` with only the rows whose title or directory holds every word of `query`, ignoring case. */
export function searchSessions(lists: SidebarSessions, query: string): SidebarSessions {
	if (!query.trim()) return lists;
	const holds = everyWord(query);
	const matches = (title: string | null, cwdDisplay: string): boolean => holds(`${title ?? ""}\n${cwdDisplay}`);
	const hosts = (rows: RosterHost[]): RosterHost[] => rows.filter(host => matches(host.sessionName, host.cwdDisplay));
	const past = (rows: PastSession[]): PastSession[] => rows.filter(session => matches(session.title, session.cwdDisplay));
	return {
		pinned: { hosts: hosts(lists.pinned.hosts), past: past(lists.pinned.past) },
		running: hosts(lists.running),
		idle: hosts(lists.idle),
		interrupted: past(lists.interrupted),
		ended: past(lists.ended),
	};
}

/** Whether live session `host` waits on your move: a turn that finished, or a question left open. */
export const waitsOnYou = (host: RosterHost): boolean => host.status === "idle" || host.status === "needs-input";

/** How many live sessions in `lists` wait on your move. */
export const waitingCount = ({ pinned, running, idle }: SidebarSessions): number => [...pinned.hosts, ...running, ...idle].filter(waitsOnYou).length;

/** The session the Sessions tab opens when no pane shows one: of the rows `lists` holds, the live one started last, else the past one saved last. */
export function latestSession({ pinned, running, idle, interrupted, ended }: SidebarSessions): View | null {
	const live = [...pinned.hosts, ...running, ...idle].toSorted(newestFirst)[0];
	if (live) return { kind: "live", instanceId: live.instanceId, agentId: null };
	const saved = [...pinned.past, ...interrupted, ...ended].toSorted(newestPastFirst)[0];
	return saved ? { kind: "past", sessionId: saved.sessionId } : null;
}

/** Every row of the sessions tab in its order, which the previous and next session keys walk. */
export function listedViews({ pinned, running, idle, interrupted, ended }: SidebarSessions): View[] {
	const live = (hosts: RosterHost[]): View[] => hosts.map(({ instanceId }) => ({ kind: "live", instanceId, agentId: null }));
	const saved = (sessions: PastSession[]): View[] => sessions.map(({ sessionId }) => ({ kind: "past", sessionId }));
	return [...live(pinned.hosts), ...saved(pinned.past), ...live([...idle, ...running]), ...saved([...interrupted, ...ended])];
}
