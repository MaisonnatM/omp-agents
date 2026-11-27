/** The left sidebar's roster: the projects, then the Workspaces section, whose label picks the workspace, and its search, then the pinned sessions, each workspace's sessions, and the past ones. */
import { IconArrowLoopDownLeft, IconCalendarClock, IconDotGrid1x3Horizontal, IconFlag1, IconFolder1, IconFolderOpen, IconLoader, IconMagnifyingGlass, IconPin, IconPlusSmall } from "central-icons";
import { type ReactNode, useContext, useState } from "react";
import { awaitsScheduled, type PastSession, type RosterHost, type View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import type { BoardState } from "../../templates/omp/agent/extensions/board/log";
import { SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { needsYou } from "../attention";
import { workspaceName } from "../../src/shared/workspaces";
import { ALL_WORKSPACES, sessionsWaiting, waitingOnYou } from "../labels";
import { type ProjectGroup, type RosterFolder, rosterFolders, rowPlacement, type SidebarSessions, type WorkspaceGroup } from "../sessions";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredKeys, useStoredState } from "../stored-state";
import { CommandPicker } from "./command-picker";
import { CountPill } from "./count-pill";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { HostRow, PastRow } from "./session-row";
import { activityControl } from "../activity";
import { useModulesOff } from "../modules-off";
import { hashForProject } from "../routing";
import { usePageHash } from "../page-hash";
import { createProject } from "./projects/new-project";
import { SidebarOpen } from "./sidebar-panel";
import { SidebarSearch } from "./sidebar-search";
import { workspaceItems } from "./workspace-picker";
import { useSeen, waitingIn } from "./board/seen";

const COLLAPSED_GROUPS_KEY = "omp-agents.sidebar-collapsed-groups";
/** Past stays folded under the workspaces until you unfold it, which this browser keeps. */
const PAST_OPEN_KEY = "omp-agents.sidebar-past-open";
/** Past sessions the list shows at first, and how many more each "Show more" adds; the rest stay out of the page until asked for. */
const PAST_PAGE = 100;
/** Workspaces the roster shows before "N more", unless more of them hold sessions. */
const GROUPS_SHOWN = 8;

interface SidebarWorkspacePickerProps {
	/** The workspaces, as {@link listWorkspaces} lists them. */
	workspaces: Workspace[];
	onPick: (cwd: string | null) => void;
}

/** The Workspaces section's label: scopes the roster to one directory's running and past sessions, or to all of them. */
function SidebarWorkspacePicker({ workspaces, onPick }: SidebarWorkspacePickerProps) {
	const [open, setOpen] = useState(false);
	const current = useDashboardStatus().scope.workspace;
	useShortcuts({ workspace: () => setOpen(shown => !shown) });
	const selected = workspaces.find(workspace => workspace.cwd === current);
	const label = selected ? workspaceName(selected.cwdDisplay) : ALL_WORKSPACES;
	const pick = (cwd: string | null) => (): void => {
		if (cwd !== current) onPick(cwd);
	};

	return (
		<CommandPicker
			trigger={selected ? label : "Workspaces"}
			control="sidebar.workspace"
			tooltip={selected?.cwdDisplay ?? ALL_WORKSPACES}
			shortcut="workspace"
			ariaLabel={`Show sessions from: ${label}`}
			className="h-6 min-w-0 gap-1 px-2 text-xs font-normal text-muted-foreground"
			search={{ label: "Search workspaces" }}
			width="md"
			open={open}
			onOpenChange={setOpen}
			list={{
				kind: "ready",
				groups: [
					{ key: "all", items: [{ value: ALL_WORKSPACES, label: ALL_WORKSPACES, selected: current === null, onSelect: pick(null) }] },
					{
						key: "workspaces",
						heading: "Workspaces",
						items: workspaceItems(workspaces, current, workspace => pick(workspace.cwd)()),
					},
				],
			}}
			empty="No workspace matches."
		/>
	);
}

interface WorkspaceFolderProps {
	folder: RosterFolder;
	/** The workspace's name, yours if you gave it one, else its path. */
	name: string;
	/** The folder shows its rows; you fold it with its label. */
	open: boolean;
	/** The Board, whose threads with unread replies in this workspace count with its sessions that need you. */
	board: BoardState | null;
	onOpenChange: () => void;
	/** The folder's session rows, in order. */
	children: ReactNode;
}

/** A workspace in the roster: a folder of its session rows, or with none its name alone. */
function WorkspaceFolder({ folder: { group, rows }, board, name, open, onOpenChange, children }: WorkspaceFolderProps) {
	const waiting = waitingIn(board, useSeen(), group.hosts, group.workspace.cwd);
	return (
		<SidebarGroup className="group/workspace py-0" collapsible={rows > 0} open={open} onOpenChange={onOpenChange}>
			<SidebarGroupLabel icon={rows > 0 && open ? IconFolderOpen : IconFolder1} title={group.workspace.cwdDisplay} className="h-7 text-[13px] text-foreground/85 hover:text-foreground">
				{name}
				{waiting > 0 && (
					<>
						<CountPill count={waiting} />
						<span className="sr-only">{`, ${waitingOnYou(waiting)}`}</span>
					</>
				)}
			</SidebarGroupLabel>
			{rows > 0 && (
				<SidebarMenu aria-label={`omp sessions in ${name}`} className="ml-[15px] w-auto gap-px border-l border-border pl-1">
					{children}
				</SidebarMenu>
			)}
		</SidebarGroup>
	);
}

interface ProjectFolderProps {
	group: ProjectGroup;
	/** Its page is open, which highlights its name. */
	current: boolean;
	/** The project's session rows, in order. */
	children: ReactNode;
}

/** A project in the roster: its name, which opens its page, over its session rows from every workspace; it sits level with a workspace's folder. */
function ProjectFolder({ group: { project, hosts, past }, current, children }: ProjectFolderProps) {
	const waiting = hosts.filter(needsYou).length;
	const rows = hosts.length + past.length;
	return (
		<SidebarGroup className="p-0">
			<SidebarGroupLabel
				icon={IconFlag1}
				title={project.goal || project.name}
				render={<a href={hashForProject(project.id)} aria-current={current ? "page" : undefined} {...activityControl("projects.open")} />}
				className={cn("h-7 rounded-md text-[13px] text-foreground/85 hover:bg-sidebar-accent hover:text-foreground", current && "bg-sidebar-accent font-medium text-foreground")}
			>
				{project.name}
				{waiting > 0 && (
					<>
						<CountPill count={waiting} />
						<span className="sr-only">{`, ${sessionsWaiting(waiting)}`}</span>
					</>
				)}
			</SidebarGroupLabel>
			{rows > 0 && (
				<SidebarMenu aria-label={`omp sessions in ${project.name}`} className="ml-[15px] w-auto gap-px border-l border-border pl-1">
					{children}
				</SidebarMenu>
			)}
		</SidebarGroup>
	);
}

interface ProjectsGroupProps {
	projects: ProjectGroup[];
	/** The project whose page is open; `null` for none. */
	current: string | null;
	open: boolean;
	onOpenChange: () => void;
	row: (session: RosterHost | PastSession) => ReactNode;
}

/** The Projects section, its own group above the Workspaces section: one folder per open project, and a button that starts a new one. */
function ProjectsGroup({ projects, current, open, onOpenChange, row }: ProjectsGroupProps) {
	const to = usePageHash();
	const { changeModule } = useDashboardActions();
	const newProject = (
		<SidebarGroupActions className="top-4 h-8">
			<Tooltip content="New project" side="right">
				<SidebarGroupAction aria-label="New project" {...activityControl("projects.new")} onClick={() => createProject(changeModule, to)}>
					<IconPlusSmall />
				</SidebarGroupAction>
			</Tooltip>
		</SidebarGroupActions>
	);
	return (
		<SidebarGroup className="pt-4" collapsible={projects.length > 0} open={open} onOpenChange={onOpenChange} headerActions={newProject}>
			<SidebarGroupLabel>{projects.length === 0 ? "No projects" : "Projects"}</SidebarGroupLabel>
			{projects.length > 0 && (
				<div className="flex flex-col gap-1">
					{projects.map(group => (
						<ProjectFolder key={group.project.id} group={group} current={group.project.id === current}>
							{group.hosts.map(row)}
							{group.past.map(row)}
						</ProjectFolder>
					))}
				</div>
			)}
		</SidebarGroup>
	);
}

interface RosterProps {
	/** Set where it fills the sidebar, while the Board is off: it then holds the workspace picker, which calls this. Unset in a Workspace's **Sessions** tab on the Board, which lists the live sessions without their Workspace's folder. */
	onPickWorkspace?: (cwd: string | null) => void;
	/** The workspaces, as {@link listWorkspaces} lists them, which the picker offers. */
	workspaces: Workspace[];
	/** The sessions under the selected workspace that match `query`, less those in an open project. */
	lists: SidebarSessions;
	/** The open projects with their sessions of the sidebar; empty while Projects is off, which hides the section. */
	projects: ProjectGroup[];
	/** The pinned sessions' ids, which a project folder's rows mark as pinned. */
	pinnedIds: ReadonlySet<string>;
	/** The live and interrupted sessions of `lists` by workspace. */
	groups: WorkspaceGroup[];
	/** What the search field holds; it narrows `lists`. */
	query: string;
	onQuery: (query: string) => void;
	/** Pin session `sessionId`, or unpin it when it is pinned; the same function on every render. */
	onTogglePin: (sessionId: string) => void;
	/** Views on screen; their sessions' rows are highlighted, and marked while they share the screen with another pane. */
	open: View[];
	/** The project whose page is open, highlighted in Projects; `null` for none. */
	projectOpen: string | null;
	/** The Board, `null` until the server sends it. */
	board: BoardState | null;
}

interface PinnedGroupProps {
	pinned: SidebarSessions["pinned"];
	/** Views on screen, whose rows are highlighted. */
	open: View[];
	/** Each row names its workspace, as with all workspaces shown. */
	showWorkspace: boolean;
	onTogglePin: (sessionId: string) => void;
}

/** The pinned sessions, a group that folds; nothing while none is pinned. */
export function PinnedGroup({ pinned, open, showWorkspace, onTogglePin }: PinnedGroupProps) {
	const [collapsed, toggleGroup] = useStoredKeys(COLLAPSED_GROUPS_KEY);
	const count = pinned.hosts.length + pinned.past.length;
	if (count === 0) return null;
	return (
		<SidebarGroup collapsible open={!collapsed.has("pinned")} onOpenChange={() => toggleGroup("pinned")}>
			<SidebarGroupLabel icon={IconPin}>{`${count} pinned`}</SidebarGroupLabel>
			<SidebarMenu aria-label="Pinned omp sessions" className="gap-px">
				{pinned.hosts.map(host => (
					<HostRow key={host.instanceId} session={host} pinned placement={rowPlacement(open, { kind: "live", instanceId: host.instanceId, agentId: null })} showWorkspace={showWorkspace} onTogglePin={onTogglePin} />
				))}
				{pinned.past.map(session => (
					<PastRow key={session.sessionId} session={session} pinned placement={rowPlacement(open, { kind: "past", sessionId: session.sessionId })} showWorkspace={showWorkspace} onTogglePin={onTogglePin} />
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

/**
 * The roster: each workspace holds its live and interrupted sessions, the busy ones first, and Past lists the ended ones,
 * even one on screen that Past does not show.
 */
export function Roster({ workspaces, lists, projects, pinnedIds, groups, board, query, onQuery, onTogglePin, open, projectOpen, onPickWorkspace }: RosterProps) {
	const [modulesOff] = useModulesOff();
	const { start, dismissStart } = useDashboardActions();
	const { connected, starts: { resumeAll }, scope: { workspace } } = useDashboardStatus();
	const [collapsed, toggleGroup] = useStoredKeys(COLLAPSED_GROUPS_KEY);
	const [pastOpen, setPastOpen] = useStoredState(PAST_OPEN_KEY, raw => raw === "true");
	const [pastShown, setPastShown] = useState(PAST_PAGE);
	const [allGroups, setAllGroups] = useState(false);
	// The search field shows while you search: opened by its button or shortcut, it stays while it holds a query.
	// A hidden sidebar leaves the key its usual meaning.
	const sidebarOpen = useContext(SidebarOpen);
	const [searching, setSearching] = useState(false);
	const searchShown = searching || query !== "";
	useShortcuts(
		searchShown
			? {}
			: {
					sessionSearch: () => {
						if (!sidebarOpen) return false;
						setSearching(true);
						return true;
					},
				},
	);
	const { pinned, interrupted, ended } = lists;
	const waitingHosts = groups.flatMap(group => group.hosts.filter(awaitsScheduled));
	const resumingAll = resumeAll?.phase === "starting";
	/** The search field narrows the lists, so a workspace left empty hides rather than showing no sessions. */
	const filtering = query.trim() !== "";
	const showWorkspace = workspace === null;
	const folders = rosterFolders(groups, { limit: GROUPS_SHOWN, all: allGroups, filtering });
	const hostRow = (host: SidebarSessions["running"][number], isPinned: boolean, badged: boolean) => (
		<HostRow key={host.instanceId} session={host} pinned={isPinned} placement={rowPlacement(open, { kind: "live", instanceId: host.instanceId, agentId: null })} showWorkspace={badged} onTogglePin={onTogglePin} />
	);
	const pastRow = (session: PastSession, isPinned: boolean, badged: boolean) => (
		<PastRow key={session.sessionId} session={session} pinned={isPinned} placement={rowPlacement(open, { kind: "past", sessionId: session.sessionId })} showWorkspace={badged} onTogglePin={onTogglePin} />
	);
	const hiddenPast = ended.length - pastShown;
	const nothing = pinned.hosts.length + pinned.past.length === 0 && projects.every(group => group.hosts.length + group.past.length === 0) && folders.shown.every(folder => folder.rows === 0) && ended.length === 0;
	const projectRow = (session: RosterHost | PastSession) => {
		const isPinned = pinnedIds.has(session.sessionId);
		return "instanceId" in session ? hostRow(session, isPinned, showWorkspace) : pastRow(session, isPinned, showWorkspace);
	};
	return (
		<>
			{!modulesOff.has("projects") && (!filtering || projects.length > 0) && (onPickWorkspace !== undefined || projects.length > 0) && (
				<ProjectsGroup projects={projects} current={projectOpen} open={!collapsed.has("projects")} onOpenChange={() => toggleGroup("projects")} row={projectRow} />
			)}
			<SidebarGroup className="gap-1 pt-4 pb-1">
				<div className="flex h-6 min-w-0 items-center gap-0.5">
					{onPickWorkspace && <SidebarWorkspacePicker workspaces={workspaces} onPick={onPickWorkspace} />}
					<SidebarGroupActions className="relative top-auto right-auto ml-auto h-6 shrink-0 pr-1.5">
						{!searchShown && (
							<Tooltip content="Search sessions" shortcut={shortcutLabels("sessionSearch")}>
								<SidebarGroupAction asChild>
									<button type="button" aria-label="Search sessions" onClick={() => setSearching(true)}>
										<IconMagnifyingGlass />
									</button>
								</SidebarGroupAction>
							</Tooltip>
						)}
						{interrupted.length > 0 && (
							<Tooltip content={resumingAll ? "Resuming…" : `Resume all ${interrupted.length} interrupted`} disabled={resumingAll || !connected}>
								<SidebarGroupAction asChild className="disabled:pointer-events-none disabled:opacity-50">
									<button
										type="button"
										aria-label={resumingAll ? "Resuming interrupted sessions" : "Resume all interrupted sessions"}
										disabled={resumingAll || !connected}
										onClick={() => start({ kind: "resume-all", sessionIds: interrupted.map(session => session.sessionId) })}
									>
										{resumingAll ? <IconLoader className="animate-spin" /> : <IconArrowLoopDownLeft />}
									</button>
								</SidebarGroupAction>
							</Tooltip>
						)}
					</SidebarGroupActions>
				</div>
				{resumeAll?.phase === "failed" && (
					<p role="alert" className="flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
						<span className="min-w-0 flex-1">{resumeAll.error}</span>
						<button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => dismissStart("resume-all")}>
							Dismiss
						</button>
					</p>
				)}
				{searchShown && (
					<SidebarSearch
						label="Filter the sidebar's sessions"
						placeholder="Search sessions"
						query={query}
						onQuery={onQuery}
						shortcut="sessionSearch"
						autoFocus={searching}
						onLeave={() => setSearching(false)}
					/>
				)}
			</SidebarGroup>
			{filtering && nothing && <p className="px-4 py-2 text-xs text-muted-foreground">{`No sessions match “${query.trim()}”`}</p>}
			<PinnedGroup pinned={pinned} open={open} showWorkspace={showWorkspace} onTogglePin={onTogglePin} />
			{onPickWorkspace === undefined ? (
				// A Workspace's Sessions tab names its Workspace already, so its live sessions list without the folder.
				<SidebarGroup className="py-0">
					<SidebarMenu aria-label="omp sessions" className="gap-px">
						{folders.shown.flatMap(folder => folder.group.hosts.filter(host => !awaitsScheduled(host)).map(host => hostRow(host, false, false)))}
					</SidebarMenu>
				</SidebarGroup>
			) : (
				folders.shown.map(folder => {
					const { cwd, cwdDisplay } = folder.group.workspace;
					const key = `workspace:${cwd}`;
					return (
						<WorkspaceFolder key={cwd} folder={folder} board={board} name={workspaceName(cwdDisplay)} open={!collapsed.has(key)} onOpenChange={() => toggleGroup(key)}>
							{folder.group.hosts.filter(host => !awaitsScheduled(host)).map(host => hostRow(host, false, false))}
						</WorkspaceFolder>
					);
				})
			)}
			{onPickWorkspace !== undefined && (folders.more > 0 || (allGroups && folders.foldable)) && (
				<SidebarGroup className="py-0">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton icon={IconDotGrid1x3Horizontal} className="text-muted-foreground" onClick={() => setAllGroups(all => !all)}>
								{folders.more > 0 ? `${folders.more} more workspace${folders.more === 1 ? "" : "s"}` : "Fewer workspaces"}
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			)}
			{waitingHosts.length > 0 && (
				<SidebarGroup collapsible open={!collapsed.has("waiting")} onOpenChange={() => toggleGroup("waiting")}>
					<SidebarGroupLabel icon={IconCalendarClock}>
						Waiting
						<span className="tabular-nums text-muted-foreground/70">{waitingHosts.length}</span>
					</SidebarGroupLabel>
					<SidebarMenu aria-label="Waiting omp sessions" className="gap-px">
						{waitingHosts.map(host => hostRow(host, false, showWorkspace))}
					</SidebarMenu>
				</SidebarGroup>
			)}
			{(!filtering || ended.length > 0) && (
				<SidebarGroup collapsible open={pastOpen} onOpenChange={setPastOpen}>
					<SidebarGroupLabel>
						{ended.length === 0 ? "No past sessions" : "Past"}
						{ended.length > 0 && <span className="tabular-nums text-muted-foreground/70">{ended.length}</span>}
					</SidebarGroupLabel>
					<SidebarMenu aria-label="Past omp sessions" className="gap-px">
						{ended.slice(0, pastShown).map(session => pastRow(session, false, showWorkspace))}
						{hiddenPast > 0 && (
							<SidebarMenuItem>
								<SidebarMenuButton className="text-muted-foreground" onClick={() => setPastShown(shown => shown + PAST_PAGE)}>
									{`Show ${Math.min(hiddenPast, PAST_PAGE)} more`}
								</SidebarMenuButton>
							</SidebarMenuItem>
						)}
					</SidebarMenu>
				</SidebarGroup>
			)}
		</>
	);
}
