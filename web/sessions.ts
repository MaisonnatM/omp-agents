/** What the roster and past-session lists say about where sessions ran, and what they work on. */
import { type Project, type Worker, type WorkerPhase, workerPhase } from "../src/shared/projects";
import { type PastSession, type RosterHost, type View, type WorkItem, worksOn } from "../src/shared/sessions";
import type { Workspace } from "../src/shared/workspaces";
import { hasEveryWord } from "./every-word";

const HIDDEN_ROOTS = ["/tmp", "/private/tmp"];

/** A working directory outside `/tmp` and `/private/tmp`, including their descendants, and not one Settings → Workspaces hid. */
export function discoverableCwd(cwd: string, hidden: ReadonlySet<string>): boolean {
	return !hidden.has(cwd) && !HIDDEN_ROOTS.some(root => cwd === root || cwd.startsWith(`${root}/`));
}

/** The running sessions that work on `item`: their tool calls named it, or a quick action on it started them. */
export const sessionsOn = (item: WorkItem, hosts: RosterHost[]): RosterHost[] => hosts.filter(host => worksOn(host, item));

export function discoverableSessions(hosts: RosterHost[], past: PastSession[], hidden: ReadonlySet<string>): { hosts: RosterHost[]; past: PastSession[] } {
	const listed = <T extends { cwd: string }>(rows: T[]): T[] => rows.filter(row => discoverableCwd(row.cwd, hidden));
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

/** A session as the lists show it: its live row while it runs, else its saved one. */
export type SessionRow = { kind: "live"; host: RosterHost } | { kind: "past"; session: PastSession };

/** What opens `row`: its live view while it runs, else its transcript. */
const viewOf = (row: SessionRow): View => (row.kind === "live" ? { kind: "live", instanceId: row.host.instanceId, agentId: null } : { kind: "past", sessionId: row.session.sessionId });

/** A session of a project, as the sidebar and the Projects page show it; `row`, `view`, and `cwdDisplay` are `null` until either list names it. */
export interface ProjectSession {
	row: SessionRow | null;
	view: View | null;
	phase: WorkerPhase;
	cwdDisplay: string | null;
}

export function projectSession(sessionId: string, hosts: RosterHost[], past: PastSession[]): ProjectSession {
	const host = hosts.find(candidate => candidate.sessionId === sessionId);
	const session = host ? undefined : past.find(candidate => candidate.sessionId === sessionId);
	const row: SessionRow | null = host ? { kind: "live", host } : session ? { kind: "past", session } : null;
	return {
		row,
		view: row && viewOf(row),
		phase: workerPhase(host?.status ?? null, session?.interrupted ?? false),
		cwdDisplay: host?.cwdDisplay ?? session?.cwdDisplay ?? null,
	};
}

/** A session of a project as the sidebar lists it. A pinned member stays in its project, and `pinned` says it is pinned. */
export interface ProjectMember {
	/** The worker it is, whose title the coordinator gave it names the row; `null` for the coordinator. */
	worker: Worker | null;
	row: SessionRow;
	pinned: boolean;
}

/** A project's group in the sessions tab: its coordinator first, then its workers in order, `w1` first. */
export interface ProjectGroup {
	project: Project;
	members: ProjectMember[];
}

/** Every session, temporary and hidden directories too, and the projects: a project lists its sessions wherever they run. */
export interface ProjectSources {
	projects: Project[];
	hosts: RosterHost[];
	past: PastSession[];
}

/** The sessions tab's lists, each only from `workspace` when one is selected. A project's session leaves the other lists for its project, and a pinned session leaves its own list for `pinned`. */
export interface SidebarSessions {
	/** The projects not archived, with a session in `workspace` or started there. */
	projects: ProjectGroup[];
	/** Pinned running sessions, then pinned past ones, interrupted first. */
	pinned: { hosts: RosterHost[]; past: PastSession[] };
	/** Live sessions whose turn runs, or that wait on a question. */
	running: RosterHost[];
	/** Live sessions that finished their turn: the blue dot. */
	idle: RosterHost[];
	interrupted: PastSession[];
	ended: PastSession[];
}

/** `project`'s sessions that run or were saved, coordinator first; a worker whose session neither runs nor is listed yet is left out. */
function projectMembers(project: Project, hosts: RosterHost[], past: PastSession[], pinned: ReadonlySet<string>): ProjectMember[] {
	const members = [{ worker: null, sessionId: project.coordinator.sessionId }, ...project.workers.map(worker => ({ worker, sessionId: worker.sessionId }))];
	return members.flatMap(({ worker, sessionId }): ProjectMember[] => {
		const { row } = projectSession(sessionId, hosts, past);
		return row ? [{ worker, row, pinned: pinned.has(sessionId) }] : [];
	});
}

export function sidebarSessions(hosts: RosterHost[], past: PastSession[], workspace: string | null, pinned: ReadonlySet<string>, sources: ProjectSources): SidebarSessions {
	const inWorkspace = (row: { cwd: string }): boolean => workspace === null || row.cwd === workspace;
	const projects = sources.projects
		.filter(project => !project.archived)
		.map(project => ({ project, members: projectMembers(project, sources.hosts, sources.past, pinned) }))
		.filter(({ project, members }) => inWorkspace(project) || members.some(({ row }) => inWorkspace(row.kind === "live" ? row.host : row.session)));
	const members = new Set(projects.flatMap(group => [group.project.coordinator.sessionId, ...group.project.workers.map(worker => worker.sessionId)]));
	const listed = (row: { cwd: string; sessionId: string }): boolean => inWorkspace(row) && !members.has(row.sessionId);
	const isPinned = (row: { sessionId: string }): boolean => pinned.has(row.sessionId);
	const shownHosts = hosts.filter(listed);
	const unpinnedHosts = shownHosts.filter(host => !isPinned(host));
	const shownPast = past.filter(listed);
	return {
		projects,
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

/** `lists` with only the rows whose title or directory holds every word of `query`, ignoring case; a project whose name matches keeps every row. */
export function searchSessions(lists: SidebarSessions, query: string): SidebarSessions {
	if (!query.trim()) return lists;
	const matches = (title: string | null, cwdDisplay: string): boolean => hasEveryWord(`${title ?? ""}\n${cwdDisplay}`, query);
	const hosts = (rows: RosterHost[]): RosterHost[] => rows.filter(host => matches(host.sessionName, host.cwdDisplay));
	const past = (rows: PastSession[]): PastSession[] => rows.filter(session => matches(session.title, session.cwdDisplay));
	// A worker's row reads as the title the coordinator gave it.
	const member = ({ worker, row }: ProjectMember): boolean =>
		row.kind === "live" ? matches(worker?.title ?? row.host.sessionName, row.host.cwdDisplay) : matches(worker?.title ?? row.session.title, row.session.cwdDisplay);
	return {
		projects: lists.projects.flatMap(group => {
			if (matches(group.project.name, "")) return [group];
			const members = group.members.filter(member);
			return members.length > 0 ? [{ ...group, members }] : [];
		}),
		pinned: { hosts: hosts(lists.pinned.hosts), past: past(lists.pinned.past) },
		running: hosts(lists.running),
		idle: hosts(lists.idle),
		interrupted: past(lists.interrupted),
		ended: past(lists.ended),
	};
}

/** The live sessions of `groups`. */
export const projectHosts = (groups: ProjectGroup[]): RosterHost[] => groups.flatMap(({ members }) => members.flatMap(({ row }) => (row.kind === "live" ? [row.host] : [])));

/** Whether live session `host` waits on your move: a turn that finished, or a question left open. */
export const waitsOnYou = (host: RosterHost): boolean => host.status === "idle" || host.status === "needs-input";

/** How many live sessions in `lists` wait on your move. */
export const waitingCount = ({ projects, pinned, running, idle }: SidebarSessions): number => [...projectHosts(projects), ...pinned.hosts, ...running, ...idle].filter(waitsOnYou).length;

/** Every row of the sessions tab in its order, which the previous and next session keys walk. */
export function listedViews({ projects, pinned, running, idle, interrupted, ended }: SidebarSessions): View[] {
	const live = (hosts: RosterHost[]): View[] => hosts.map(({ instanceId }) => ({ kind: "live", instanceId, agentId: null }));
	const saved = (sessions: PastSession[]): View[] => sessions.map(({ sessionId }) => ({ kind: "past", sessionId }));
	const members = projects.flatMap(({ members }) => members.map(({ row }) => viewOf(row)));
	return [...members, ...live(pinned.hosts), ...saved(pinned.past), ...live([...idle, ...running]), ...saved([...interrupted, ...ended])];
}
