/** What the roster and past-session lists say about where sessions ran, and what they work on. */
import type { ScheduledSend } from "../src/shared/scheduled";
import { awaitsSubagents, newestPastFirst, type PastSession, type RosterHost, type View, type WorkItem, worksOn } from "../src/shared/sessions";
import { inAppData, inTempDir, type Space, type Spaces, type Workspace } from "../src/shared/workspaces";
import { everyWord } from "../src/shared/every-word";
import { needsYou } from "./attention";
import type { Layout, Page } from "./routing";
import { pageSpace } from "./sidebar-tabs";

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

/** The space session `row` counts in, as `spaces` places its workspace. */
export const spaceOf = (row: { cwd: string; workspace: Workspace | null }, spaces: Spaces): Space => spaces.of(row.cwd, workspaceCwd(row));

/** What a window shows: its space, the workspace selected in it, and where a session or todo of All of the space starts. */
export interface WindowScope {
	space: Space;
	/** Which space each directory is in. */
	spaces: Spaces;
	/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all of the space's workspaces. */
	workspace: string | null;
	/** Where All of the space starts a new session or todo: the personal directory in Personal; `null` in Work, and before the server names it. */
	home: Workspace | null;
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

/** The sessions of `lists` that count in `space`. */
export function sessionsIn(lists: { hosts: RosterHost[]; past: PastSession[] }, space: Space, spaces: Spaces): { hosts: RosterHost[]; past: PastSession[] } {
	const inSpace = (row: RosterHost | PastSession): boolean => spaceOf(row, spaces) === space;
	return { hosts: lists.hosts.filter(inSpace), past: lists.past.filter(inSpace) };
}

/**
 * The scheduled sends of `sends` in `space`: a start in the space of the directory it starts in, a message or a continue in its
 * session's, as `sessions` lists it, and in Work when they do not.
 */
export function scheduledIn(sends: readonly ScheduledSend[], space: Space, sessions: { hosts: RosterHost[]; past: PastSession[] }, spaces: Spaces): ScheduledSend[] {
	const sessionSpace = (sessionId: string): Space => {
		const row = sessions.hosts.find(host => host.sessionId === sessionId) ?? sessions.past.find(session => session.sessionId === sessionId);
		return row ? spaceOf(row, spaces) : "work";
	};
	return sends.filter(({ target }) => (target.kind === "start" ? spaces.of(target.request.cwd, target.request.cwd) : sessionSpace(target.sessionId)) === space);
}

/** The workspaces of `workspaces` in `space`, with Personal's starting at the personal directory, where its new sessions start. */
export function workspacesIn(workspaces: Workspace[], space: Space, spaces: Spaces, personalDir: Workspace | null): Workspace[] {
	const inSpace = spaces.inSpace(workspaces, space);
	if (space === "work" || !personalDir) return inSpace;
	return [personalDir, ...inSpace.filter(({ cwd }) => !spaces.isPersonalDir(cwd))];
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
 * What a switch from space `from` to `to` does to the panes under `page`: a page of both spaces, or of `to`, stays; otherwise the
 * panes leave, or a page of `from` such as Sport gives way to them, for the newest session running in `to`, else show none.
 */
export function spaceSwitchPanes(page: Page | null, layout: Layout, from: Space, to: Space, hosts: RosterHost[], spaces: Spaces): View | "empty" | "stay" {
	if (page && pageSpace(page) !== from) return "stay";
	const session = layout.panes.length === 0 ? null : spaceSession(to, hosts, spaces);
	return session ?? "empty";
}

/** The session the panes follow a switch to `space` into: its most recently started running one; `null` when none runs there. */
export function spaceSession(space: Space, hosts: RosterHost[], spaces: Spaces): View | null {
	const newest = hosts.filter(host => spaceOf(host, spaces) === space).toSorted(newestFirst)[0];
	return newest ? { kind: "live", instanceId: newest.instanceId, agentId: null } : null;
}

/**
 * Where a new session starts unless the user picks another directory: `workspace` when one is selected, else `home`, the personal
 * directory in Personal, else the workspace of the open session, of the newest live one, or of the newest past one.
 * With `workspace` selected, it is the directory of one of its sessions, so a linked worktree hands on its repository's main checkout.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], { workspace, home }: Pick<WindowScope, "workspace" | "home">): string {
	if (workspace === null && home !== null) return home.cwdDisplay;
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
	/** Live sessions whose subagents still run while the main agent's turn has ended or only waits on them. */
	awaitingSubagents: RosterHost[];
	interrupted: PastSession[];
	ended: PastSession[];
}

/** The sessions tab lists an unpinned live session can land in, in the order the sidebar shows them. */
const LIVE_LISTS = ["idle", "running", "awaitingSubagents"] as const satisfies readonly (keyof SidebarSessions)[];
type LiveList = (typeof LIVE_LISTS)[number];

/** Every live session `lists` holds outside pinned, in the sidebar's order. */
export const liveHosts = (lists: Pick<SidebarSessions, LiveList>): RosterHost[] => LIVE_LISTS.flatMap(list => lists[list]);

/** Where a sidebar row's session shows: in no pane, alone, or in a split with other panes. */
export type RowPlacement = "hidden" | "alone" | "split";

/** Where `row`, a session's own view, shows among `panes`; a pane of one of its subagents shows the session too. */
export function rowPlacement(panes: readonly View[], row: View): RowPlacement {
	const shown = panes.some(pane => (row.kind === "live" ? pane.kind === "live" && pane.instanceId === row.instanceId : pane.kind === "past" && pane.sessionId === row.sessionId));
	if (!shown) return "hidden";
	return panes.length > 1 ? "split" : "alone";
}

/** The list unpinned live session `host` lands in: `idle` and `running` hold the sessions that wait on no subagent, by its status. */
function liveList(host: RosterHost): LiveList {
	if (awaitsSubagents(host)) return "awaitingSubagents";
	return host.status === "idle" ? "idle" : "running";
}

export function sidebarSessions(hosts: RosterHost[], past: PastSession[], workspace: string | null, pinned: ReadonlySet<string>): SidebarSessions {
	const listed = (row: RosterHost | PastSession): boolean => workspace === null || workspaceCwd(row) === workspace;
	const isPinned = (row: { sessionId: string }): boolean => pinned.has(row.sessionId);
	const shownHosts = hosts.filter(listed);
	const shownPast = past.filter(listed);
	const live: Record<LiveList, RosterHost[]> = { running: [], idle: [], awaitingSubagents: [] };
	for (const host of shownHosts) if (!isPinned(host)) live[liveList(host)].push(host);
	return {
		pinned: {
			hosts: shownHosts.filter(isPinned),
			past: shownPast.filter(isPinned).toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted)),
		},
		...live,
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
		awaitingSubagents: hosts(lists.awaitingSubagents),
		interrupted: past(lists.interrupted),
		ended: past(lists.ended),
	};
}

/** How many live sessions in `lists` need you: each that asks you something, or finished a turn you have not looked at since, as the Dock badge counts them. */
export const waitingCount = (lists: SidebarSessions): number => [...lists.pinned.hosts, ...liveHosts(lists)].filter(needsYou).length;

/** How many of `everySpace`'s live sessions listed in `space` need you, as its Sessions tab counts them. */
export const waitingIn = (everySpace: { hosts: RosterHost[]; past: PastSession[] }, space: Space, spaces: Spaces): number => sessionsIn(everySpace, space, spaces).hosts.filter(needsYou).length;

/** The session the Sessions tab opens when no pane shows one: of the rows `lists` holds, the live one started last, else the past one saved last. */
export function latestSession(lists: SidebarSessions): View | null {
	const { pinned, interrupted, ended } = lists;
	const live = [...pinned.hosts, ...liveHosts(lists)].toSorted(newestFirst)[0];
	if (live) return { kind: "live", instanceId: live.instanceId, agentId: null };
	const saved = [...pinned.past, ...interrupted, ...ended].toSorted(newestPastFirst)[0];
	return saved ? { kind: "past", sessionId: saved.sessionId } : null;
}

/** Every row of the sessions tab in its order, which the previous and next session keys walk. */
export function listedViews(lists: SidebarSessions): View[] {
	const { pinned, interrupted, ended } = lists;
	const live = (hosts: RosterHost[]): View[] => hosts.map(({ instanceId }) => ({ kind: "live", instanceId, agentId: null }));
	const saved = (sessions: PastSession[]): View[] => sessions.map(({ sessionId }) => ({ kind: "past", sessionId }));
	return [...live(pinned.hosts), ...saved(pinned.past), ...live(liveHosts(lists)), ...saved([...interrupted, ...ended])];
}
