/** What the roster and past-session lists say about where sessions ran, and what they work on. */
import type { Project } from "../src/shared/projects";
import { awaitsCi, awaitsScheduled, awaitsSubagents, newestPastFirst, type PastSession, type RosterHost, type View, type WorkItem, worksOn } from "../src/shared/sessions";
import { inAppData, inTempDir, type Workspace } from "../src/shared/workspaces";
import { everyWord } from "../src/shared/every-word";
import { needsYou } from "./attention";

/** A working directory outside the temp directories, and not one Settings → Workspaces hid. */
export function discoverableCwd(cwd: string, hidden: ReadonlySet<string>): boolean {
	return !hidden.has(cwd) && !inTempDir(cwd);
}

/** The running sessions that work on `item`: their tool calls named it, or a quick action on it started them. */
export const sessionsOn = (item: WorkItem, hosts: RosterHost[]): RosterHost[] => hosts.filter(host => worksOn(host, item));

/** The workspace a session counts in: its repository's main checkout when it ran in a linked worktree, else the directory it ran in. */
export const workspaceOf = (row: { cwd: string; cwdDisplay: string; workspace: Workspace | null }): Workspace => row.workspace ?? { cwd: row.cwd, cwdDisplay: row.cwdDisplay };

/** The directory of the workspace a session counts in, {@link workspaceOf}'s `cwd`. */
export const workspaceCwd = (row: { cwd: string; workspace: Workspace | null }): string => row.workspace?.cwd ?? row.cwd;

/** What a window shows: the workspace selected in it. */
export interface WindowScope {
	/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all workspaces. */
	workspace: string | null;
}

/** Ending session `host` deletes it with everything it wrote, as for a private session this dashboard started. */
export const isPrivateHost = (host: RosterHost | null | undefined): boolean => host?.source === "dashboard" && host.private;

/**
 * The sessions the sidebar, the palette, and the pages list: none in a temporary directory, none counting in a hidden workspace,
 * and none in `botSessions`, a Bot's conversation, which only its Bot's page shows.
 */
export function discoverableSessions(
	hosts: RosterHost[],
	past: PastSession[],
	hidden: ReadonlySet<string>,
	botSessions: ReadonlySet<string>,
): { hosts: RosterHost[]; past: PastSession[] } {
	const shown = (row: RosterHost | PastSession): boolean => discoverableCwd(row.cwd, hidden) && !hidden.has(workspaceCwd(row)) && !botSessions.has(row.sessionId);
	return { hosts: hosts.filter(shown), past: past.filter(shown) };
}


/**
 * The workspace a started or picked session switches to, so it stays listed: `cwd`, the workspace it counts in. `null` keeps the current
 * workspace; a temporary or hidden directory is not a switch.
 */
export function workspaceSwitch(workspace: string | null, cwd: string, hidden: ReadonlySet<string>): string | null {
	if (workspace === null || cwd === workspace || !discoverableCwd(cwd, hidden)) return null;
	return cwd;
}

const newestFirst = (a: RosterHost, b: RosterHost): number => b.startedAt - a.startedAt;

/**
 * The session the focused pane follows a picked workspace into: its most recently started running one, unless `shownWorkspace`,
 * the workspace of the session the pane shows, is `cwd` already. `null` for All workspaces, or when no session runs there.
 */
export function workspaceSession(cwd: string | null, hosts: RosterHost[], shownWorkspace: string | undefined): View | null {
	if (cwd === null || shownWorkspace === cwd) return null;
	const newest = hosts.filter(host => workspaceCwd(host) === cwd).toSorted(newestFirst)[0];
	return newest ? { kind: "live", instanceId: newest.instanceId, agentId: null } : null;
}

/**
 * Where a new session starts unless the user picks another directory: `workspace` when one is selected, else the workspace of the
 * open session, of the newest live one, or of the newest past one.
 * With `workspace` selected, it is the directory of one of its sessions, so a linked worktree hands on its repository's main checkout.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], { workspace }: WindowScope): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const rows = [...(open ? [open] : []), ...hosts.toSorted(newestFirst), ...past];
	// Sessions from old omp versions recorded no directory.
	const chosen = rows.find(row => row.cwdDisplay && (workspace === null || workspaceCwd(row) === workspace));
	return chosen ? workspaceOf(chosen).cwdDisplay : "~";
}

/**
 * The workspaces sessions count in, live ones first, then past ones newest first, then the ones Settings → Workspaces added. A
 * session in a gone directory, or in an app's own data, adds none. The settings page reads a workspace from one.
 */
export function listWorkspaces(hosts: RosterHost[], past: PastSession[], added: readonly Workspace[]): Workspace[] {
	const byCwd = new Map<string, string>();
	const ran = [...hosts.toSorted(newestFirst), ...past].filter(row => !row.gone).map(workspaceOf).filter(({ cwd }) => !inAppData(cwd));
	for (const row of [...ran, ...added]) {
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
	/** Live sessions that wait on work under way: subagents that still run while the main agent's turn has ended or only waits on them, or a scheduled check; those waiting on CI come last. */
	awaitingWork: RosterHost[];
	interrupted: PastSession[];
	ended: PastSession[];
}

/** The sessions tab lists an unpinned live session can land in, in the order the sidebar shows them. */
const LIVE_LISTS = ["idle", "running", "awaitingWork"] as const satisfies readonly (keyof SidebarSessions)[];
type LiveList = (typeof LIVE_LISTS)[number];

/** Every live session `lists` holds outside pinned, in the sidebar's order. */
const liveHosts = (lists: Pick<SidebarSessions, LiveList>): RosterHost[] => LIVE_LISTS.flatMap(list => lists[list]);

/** Where a sidebar row's session shows: in no pane, alone, or in a split with other panes. */
export type RowPlacement = "hidden" | "alone" | "split";

/** Where `row`, a session's own view, shows among `panes`; a pane of one of its subagents shows the session too. */
export function rowPlacement(panes: readonly View[], row: View): RowPlacement {
	const shown = panes.some(pane => (row.kind === "live" ? pane.kind === "live" && pane.instanceId === row.instanceId : pane.kind === "past" && pane.sessionId === row.sessionId));
	if (!shown) return "hidden";
	return panes.length > 1 ? "split" : "alone";
}

/** The list unpinned live session `host` lands in: `idle` and `running` hold the sessions that wait on no subagent or scheduled check, by its status. */
function liveList(host: RosterHost): LiveList {
	if (awaitsSubagents(host) || awaitsScheduled(host)) return "awaitingWork";
	return host.status === "idle" ? "idle" : "running";
}

export function sidebarSessions(hosts: RosterHost[], past: PastSession[], workspace: string | null, pinned: ReadonlySet<string>): SidebarSessions {
	const listed = (row: RosterHost | PastSession): boolean => workspace === null || workspaceCwd(row) === workspace;
	const isPinned = (row: { sessionId: string }): boolean => pinned.has(row.sessionId);
	const shownHosts = hosts.filter(listed);
	const shownPast = past.filter(listed);
	const live: Record<LiveList, RosterHost[]> = { running: [], idle: [], awaitingWork: [] };
	for (const host of shownHosts) if (!isPinned(host)) live[liveList(host)].push(host);
	return {
		pinned: {
			hosts: shownHosts.filter(isPinned),
			past: shownPast.filter(isPinned).toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted)),
		},
		...live,
		awaitingWork: live.awaitingWork.toSorted((a, b) => Number(awaitsCi(a)) - Number(awaitsCi(b))),
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
		awaitingWork: hosts(lists.awaitingWork),
		interrupted: past(lists.interrupted),
		ended: past(lists.ended),
	};
}

/** How many live sessions in `lists` need you: each that asks you something, or finished a turn you have not looked at since, as the Dock badge counts them. */
export const waitingCount = (lists: SidebarSessions): number => [...lists.pinned.hosts, ...liveHosts(lists)].filter(needsYou).length;

/** The session the Sessions tab opens when no pane shows one: of the rows `lists` holds, the live one started last, else the past one saved last. */
export function latestSession(lists: SidebarSessions): View | null {
	const { pinned, interrupted, ended } = lists;
	const live = [...pinned.hosts, ...liveHosts(lists)].toSorted(newestFirst)[0];
	if (live) return { kind: "live", instanceId: live.instanceId, agentId: null };
	const saved = [...pinned.past, ...interrupted, ...ended].toSorted(newestPastFirst)[0];
	return saved ? { kind: "past", sessionId: saved.sessionId } : null;
}

/** One workspace of the roster: its unpinned live sessions, in the sidebar's order, and its interrupted ones. */
export interface WorkspaceGroup {
	workspace: Workspace;
	hosts: RosterHost[];
	interrupted: PastSession[];
}

/**
 * The roster's workspaces, each with the live and interrupted sessions `lists` holds in it: one per workspace of
 * `workspaces`, then one per other workspace a session runs in. Those with a session come first, then the rest, each
 * in `workspaces` order, so opening a session never moves a workspace.
 */
export function workspaceGroups(lists: SidebarSessions, workspaces: readonly Workspace[]): WorkspaceGroup[] {
	const groups = new Map<string, WorkspaceGroup>();
	const groupOf = (row: RosterHost | PastSession): WorkspaceGroup => {
		const workspace = workspaceOf(row);
		let group = groups.get(workspace.cwd);
		if (!group) {
			group = { workspace, hosts: [], interrupted: [] };
			groups.set(workspace.cwd, group);
		}
		return group;
	};
	for (const workspace of workspaces) groups.set(workspace.cwd, { workspace, hosts: [], interrupted: [] });
	for (const host of liveHosts(lists)) groupOf(host).hosts.push(host);
	for (const session of lists.interrupted) groupOf(session).interrupted.push(session);
	const all = [...groups.values()];
	const busy = (group: WorkspaceGroup): boolean => group.hosts.length > 0 || group.interrupted.length > 0;
	return [...all.filter(busy), ...all.filter(group => !busy(group))];
}

/** A workspace the roster shows: its group, and how many session rows it holds, its live and interrupted ones. */
export interface RosterFolder {
	group: WorkspaceGroup;
	rows: number;
}

export interface RosterFolders {
	shown: RosterFolder[];
	/** How many matching folders stay behind "N more workspaces". */
	more: number;
	/** More folders match than `limit`, so the full list can fold back to fewer. */
	foldable: boolean;
}

/**
 * The roster's folders in `groups` order. At most `limit` folders show, or as many as hold a live or interrupted
 * session, unless `all`. Ended sessions stay in Past, never in a folder. `filtering` drops the folders a search leaves empty.
 */
export function rosterFolders(groups: readonly WorkspaceGroup[], { limit, all, filtering }: { limit: number; all: boolean; filtering: boolean }): RosterFolders {
	const folders = groups.map((group): RosterFolder => ({ group, rows: group.hosts.length + group.interrupted.length }));
	const matching = filtering ? folders.filter(folder => folder.rows > 0) : folders;
	const busy = matching.filter(folder => folder.rows > 0).length;
	const shown = all ? matching : matching.slice(0, Math.max(limit, busy));
	return { shown, more: matching.length - shown.length, foldable: matching.length > limit };
}

/** One project of the roster: its sessions the sidebar lists, live and pinned past ones, wherever they ran. */
export interface ProjectGroup {
	project: Project;
	/** Its pinned live sessions, then its other live ones in the sidebar's order. */
	hosts: RosterHost[];
	/** Its pinned past sessions, then its interrupted ones. */
	past: PastSession[];
}

/**
 * The roster's projects, one per project of `projects` in its order, each with the pinned, live, and interrupted sessions
 * of `lists` in it, and `lists` without them, so a session in a project leaves Pinned and its workspace's folder. Ended
 * sessions stay in Past.
 */
export function projectGroups(lists: SidebarSessions, projects: readonly Project[]): { groups: ProjectGroup[]; rest: SidebarSessions } {
	const groups = projects.map((project): ProjectGroup => ({ project, hosts: [], past: [] }));
	const bySession = new Map(groups.flatMap(group => group.project.sessionIds.map(id => [id, group] as const)));
	if (bySession.size === 0) return { groups, rest: lists };
	const take = <Row extends RosterHost | PastSession>(rows: Row[], into: (group: ProjectGroup) => Row[]): Row[] =>
		rows.filter(row => {
			const group = bySession.get(row.sessionId);
			if (group) into(group).push(row);
			return !group;
		});
	const hosts = (group: ProjectGroup) => group.hosts;
	const past = (group: ProjectGroup) => group.past;
	return {
		groups,
		rest: {
			pinned: { hosts: take(lists.pinned.hosts, hosts), past: take(lists.pinned.past, past) },
			idle: take(lists.idle, hosts),
			running: take(lists.running, hosts),
			awaitingWork: take(lists.awaitingWork, hosts),
			interrupted: take(lists.interrupted, past),
			ended: lists.ended,
		},
	};
}

/** Every row of the sessions tab in its order, which the previous and next session keys walk: each project's, pinned, then the root Waiting section's, then each workspace's, then the ended ones. */
export function listedViews(lists: SidebarSessions, projects: readonly ProjectGroup[], groups: readonly WorkspaceGroup[]): View[] {
	const { pinned, ended } = lists;
	const live = (hosts: RosterHost[]): View[] => hosts.map(({ instanceId }) => ({ kind: "live", instanceId, agentId: null }));
	const saved = (sessions: PastSession[]): View[] => sessions.map(({ sessionId }) => ({ kind: "past", sessionId }));
	return [
		...projects.flatMap(group => [...live(group.hosts), ...saved(group.past)]),
		...live(pinned.hosts),
		...saved(pinned.past),
		...groups.flatMap(group => live(group.hosts.filter(awaitsScheduled))),
		...groups.flatMap(group => [...live(group.hosts.filter(host => !awaitsScheduled(host))), ...saved(group.interrupted)]),
		...saved(ended),
	];
}
