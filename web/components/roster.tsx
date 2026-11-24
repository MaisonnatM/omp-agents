/** The left sidebar's roster: the projects, then the Workspaces section, whose label picks the workspace, and its search, then the pinned sessions, each workspace's sessions, and the past ones. */
import { IconArrowLoopDownLeft, IconDotGrid1x3Horizontal, IconFlag1, IconFolder1, IconFolderOpen, IconLoader, IconMagnifyingGlass, IconPin, IconPlusSmall } from "central-icons";
import { type ReactNode, useContext, useState } from "react";
import { awaitsCi, type PastSession, type RosterHost, type View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import { SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { needsYou } from "../attention";
import { ALL_WORKSPACES, folderName, sessionsWaiting } from "../labels";
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
import { createProject } from "./projects/new-project";
import { SidebarOpen } from "./sidebar-panel";
import { SidebarSearch } from "./sidebar-search";
import { workspaceItems } from "./workspace-picker";

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
	const label = selected ? (folderName(selected.cwdDisplay) ?? selected.cwdDisplay) : ALL_WORKSPACES;
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
	onOpenChange: () => void;
	onNewSession: () => void;
	/** The folder's session rows, in order. */
	children: ReactNode;
}

/** A workspace's sessions waiting on their pull requests' checks, last in its folder under their own label; nothing when none waits. */
function WaitingOnCi({ hosts, hostRow }: { hosts: RosterHost[]; hostRow: (host: RosterHost) => ReactNode }) {
	if (hosts.length === 0) return null;
	return (
		<>
			<li className="flex h-6 items-center gap-1.5 px-2 pt-1 text-[11px] font-medium text-muted-foreground">
				<span aria-hidden className="size-1.5 shrink-0 rounded-full border-[1.5px] border-amber-500 motion-safe:animate-pulse" />
				Waiting on CI
				<span className="tabular-nums text-muted-foreground/70">{hosts.length}</span>
			</li>
			{hosts.map(hostRow)}
		</>
	);
}

/** A workspace in the roster: a folder of its session rows, or with none its name alone; hovering it offers a new session there. */
function WorkspaceFolder({ folder: { group, rows }, name, open, onOpenChange, onNewSession, children }: WorkspaceFolderProps) {
	const waiting = group.hosts.filter(needsYou).length;
	const newHere = (
		<SidebarGroupActions className="top-0 h-7 opacity-0 transition-opacity group-hover/workspace:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
			<Tooltip content={`New session in ${name}`} side="right">
				<SidebarGroupAction aria-label={`New session in ${name}`} onClick={onNewSession}>
					<IconPlusSmall />
				</SidebarGroupAction>
			</Tooltip>
		</SidebarGroupActions>
	);
	return (
		<SidebarGroup className="group/workspace py-0" collapsible={rows > 0} open={open} onOpenChange={onOpenChange} headerActions={rows > 0 && newHere}>
			<SidebarGroupLabel icon={rows > 0 && open ? IconFolderOpen : IconFolder1} title={group.workspace.cwdDisplay} className="h-7 text-[13px] text-foreground/85 hover:text-foreground">
				{name}
				{waiting > 0 && (
					<>
						<CountPill count={waiting} />
						<span className="sr-only">{`, ${sessionsWaiting(waiting)}`}</span>
					</>
				)}
			</SidebarGroupLabel>
			{rows > 0 ? (
				<SidebarMenu aria-label={`omp sessions in ${name}`} className="ml-[15px] w-auto gap-px border-l border-border pl-1">
					{children}
				</SidebarMenu>
			) : (
				newHere
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
	const { changeModule } = useDashboardActions();
	const newProject = (
		<SidebarGroupActions className="top-4 h-8">
			<Tooltip content="New project" side="right">
				<SidebarGroupAction aria-label="New project" {...activityControl("projects.new")} onClick={() => createProject(changeModule)}>
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
	onPickWorkspace: (cwd: string | null) => void;
}

/**
 * The roster: each workspace holds its live and interrupted sessions, the busy ones first, and Past lists the ended ones,
 * even one on screen that Past does not show.
 */
export function Roster({ workspaces, lists, projects, pinnedIds, groups, query, onQuery, onTogglePin, open, projectOpen, onPickWorkspace }: RosterProps) {
	const [modulesOff] = useModulesOff();
	const { start, dismissStart, openNewSession } = useDashboardActions();
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
			{!modulesOff.has("projects") && (!filtering || projects.length > 0) && (
				<ProjectsGroup projects={projects} current={projectOpen} open={!collapsed.has("projects")} onOpenChange={() => toggleGroup("projects")} row={projectRow} />
			)}
			<SidebarGroup className="gap-1 pt-4 pb-1">
				<div className="flex h-6 min-w-0 items-center gap-0.5">
					<SidebarWorkspacePicker workspaces={workspaces} onPick={onPickWorkspace} />
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
			{pinned.hosts.length + pinned.past.length > 0 && (
				<SidebarGroup collapsible open={!collapsed.has("pinned")} onOpenChange={() => toggleGroup("pinned")}>
					<SidebarGroupLabel icon={IconPin}>{`${pinned.hosts.length + pinned.past.length} pinned`}</SidebarGroupLabel>
					<SidebarMenu aria-label="Pinned omp sessions" className="gap-px">
						{pinned.hosts.map(host => hostRow(host, true, showWorkspace))}
						{pinned.past.map(session => pastRow(session, true, showWorkspace))}
					</SidebarMenu>
				</SidebarGroup>
			)}
			{folders.shown.map(folder => {
				const { cwd, cwdDisplay } = folder.group.workspace;
				const key = `workspace:${cwd}`;
				return (
					<WorkspaceFolder key={cwd} folder={folder} name={folderName(cwdDisplay) ?? cwdDisplay} open={!collapsed.has(key)} onOpenChange={() => toggleGroup(key)} onNewSession={() => openNewSession(cwd)}>
						{folder.group.hosts.filter(host => !awaitsCi(host)).map(host => hostRow(host, false, false))}
						{folder.group.interrupted.map(session => pastRow(session, false, false))}
						<WaitingOnCi hosts={folder.group.hosts.filter(awaitsCi)} hostRow={host => hostRow(host, false, false)} />
					</WorkspaceFolder>
				);
			})}
			{(folders.more > 0 || (allGroups && folders.foldable)) && (
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
