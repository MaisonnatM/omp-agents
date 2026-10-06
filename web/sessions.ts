/** What the roster and past-session lists say about where sessions ran, and what they work on. */
import { type PastSession, type RosterHost, type View, type WorkItem, worksOn } from "../src/shared";

const HIDDEN_ROOTS = ["/tmp", "/private/tmp"];

/** A working directory outside `/tmp` and `/private/tmp`, including their descendants. */
export function discoverableCwd(cwd: string): boolean {
	return !HIDDEN_ROOTS.some(root => cwd === root || cwd.startsWith(`${root}/`));
}

/** The running sessions that work on `item`: their tool calls named it, or a quick action on it started them. */
export const sessionsOn = (item: WorkItem, hosts: RosterHost[]): RosterHost[] => hosts.filter(host => worksOn(host, item));

export function discoverableSessions(hosts: RosterHost[], past: PastSession[]): { hosts: RosterHost[]; past: PastSession[] } {
	const listed = <T extends { cwd: string }>(rows: T[]): T[] => rows.filter(row => discoverableCwd(row.cwd));
	return { hosts: listed(hosts), past: listed(past) };
}

/** The project a started or picked session switches to, so it stays listed. `null` keeps the current project; a temporary directory is not a switch. */
export function projectSwitch(project: string | null, cwd: string): string | null {
	if (project === null || cwd === project || !discoverableCwd(cwd)) return null;
	return cwd;
}

const newestFirst = (a: RosterHost, b: RosterHost): number => b.startedAt - a.startedAt;

/**
 * The session the focused pane follows a picked project into: its most recently started running one, unless the pane
 * already shows a session from `cwd`. `null` for All projects, or when no session runs there.
 */
export function projectSession(cwd: string | null, hosts: RosterHost[], shownCwd: string | undefined): View | null {
	if (cwd === null || shownCwd === cwd) return null;
	const newest = hosts.filter(host => host.cwd === cwd).toSorted(newestFirst)[0];
	return newest ? { kind: "live", instanceId: newest.instanceId, agentId: null } : null;
}

/**
 * Where a new session starts unless the user picks another directory: the open session's,
 * else the newest live one's, else the newest past one's, each only from `project` when one is selected.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], project: string | null): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const rows = [open, ...hosts.toSorted(newestFirst), ...past];
	// Sessions from old omp versions recorded no directory.
	const chosen = rows.find(row => row?.cwdDisplay && (project === null || row.cwd === project));
	return chosen?.cwdDisplay ?? "~";
}

/** Directories sessions ran in, live ones first, then past ones newest first. The settings page reads a workspace from one. */
export function workspaces(hosts: RosterHost[], past: PastSession[]): { cwd: string; cwdDisplay: string }[] {
	const byCwd = new Map<string, string>();
	for (const row of [...hosts.toSorted(newestFirst), ...past]) {
		// Sessions from old omp versions recorded no directory.
		if (row.cwd && !byCwd.has(row.cwd)) byCwd.set(row.cwd, row.cwdDisplay);
	}
	return [...byCwd].map(([cwd, cwdDisplay]) => ({ cwd, cwdDisplay }));
}

/** The sessions tab's lists, each only from `project` when one is selected. A pinned session leaves its own list for `pinned`. */
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

export function sidebarSessions(hosts: RosterHost[], past: PastSession[], project: string | null, pinned: ReadonlySet<string>): SidebarSessions {
	const inProject = (row: { cwd: string }): boolean => project === null || row.cwd === project;
	const isPinned = (row: { sessionId: string }): boolean => pinned.has(row.sessionId);
	const shownHosts = hosts.filter(inProject);
	const unpinnedHosts = shownHosts.filter(host => !isPinned(host));
	const shownPast = past.filter(inProject);
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

/** How many live sessions in `lists` wait on your move: a turn that finished, or a question left open. */
export const waitingCount = ({ pinned, running, idle }: SidebarSessions): number =>
	[...pinned.hosts, ...running, ...idle].filter(host => host.status === "idle" || host.status === "needs-input").length;

/** Every row of the sessions tab in its order, which the previous and next session keys walk. */
export function listedViews({ pinned, running, idle, interrupted, ended }: SidebarSessions): View[] {
	const live = (hosts: RosterHost[]): View[] => hosts.map(({ instanceId }) => ({ kind: "live", instanceId, agentId: null }));
	const saved = (sessions: PastSession[]): View[] => sessions.map(({ sessionId }) => ({ kind: "past", sessionId }));
	return [...live(pinned.hosts), ...saved(pinned.past), ...live([...idle, ...running]), ...saved([...interrupted, ...ended])];
}
