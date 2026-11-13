/** The left sidebar's roster: the Workspaces section, whose label picks the workspace, and its search, then the scheduled sends, the pinned sessions, each workspace's sessions, and the past ones. */
import { ArrowLeftRight, Folder, FolderOpen, ListRestart, Loader, MoreHorizontal, Pin, Plus, Search } from "lucide-react";
import { useContext, useState } from "react";
import type { ScheduledSend } from "../../src/shared/scheduled";
import type { PastSession, View } from "../../src/shared/sessions";
import { otherSpace, type Space, type Workspace } from "../../src/shared/workspaces";
import { SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorText } from "../../src/json";
import { needsYou } from "../attention";
import { ALL_OF_SPACE, SPACE_LABELS, sessionsWaiting, workspaceName } from "../labels";
import { writeWorkspace } from "../reads";
import { rosterFolders, rowPlacement, type SidebarSessions, type WorkspaceGroup } from "../sessions";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredKeys, useStoredState } from "../stored-state";
import { CommandPicker } from "./command-picker";
import { PersonalContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ScheduledGroup } from "./scheduled";
import { HostRow, PastRow } from "./session-row";
import { SidebarOpen } from "./sidebar-panel";
import { SidebarSearch } from "./sidebar-search";
import { offerUndo, toasts } from "./toaster";
import { workspaceItems } from "./workspace-picker";

const COLLAPSED_GROUPS_KEY = "omp-agents.sidebar-collapsed-groups";
/** Past stays folded under the workspaces until you unfold it, which this browser keeps. */
const PAST_OPEN_KEY = "omp-agents.sidebar-past-open";
/** Past sessions the list shows at first, and how many more each "Show more" adds; the rest stay out of the page until asked for. */
const PAST_PAGE = 100;
/** Shows a section header's button only while the header is hovered or holds focus, and always on a touch screen. */
const REVEAL = "opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";
/** Workspaces the roster shows before "N more", unless more of them hold sessions. */
const GROUPS_SHOWN = 8;

interface SidebarWorkspacePickerProps {
	/** The space's workspaces, as {@link workspacesIn} lists them. */
	workspaces: Workspace[];
	onPick: (cwd: string | null) => void;
}

/**
 * Moves workspace `cwd`, called `name`, from space `from` to `to`, with **Undo** to move it back. Every page hears the list
 * after it over its socket, and the sidebar then leaves the workspace and its sessions out of this space.
 */
async function moveWorkspace(name: string, cwd: string, from: Space, to: Space): Promise<void> {
	try {
		await writeWorkspace({ op: "space", cwd, space: to });
	} catch (error) {
		toasts.add({ title: `Could not move ${name} to ${SPACE_LABELS[to]}`, description: errorText(error) });
		return;
	}
	offerUndo("workspace-move", `Moved ${name} to ${SPACE_LABELS[to]}`, () => void moveWorkspace(name, cwd, to, from));
}

/** The Workspaces section's label: scopes the roster to one directory's running and past sessions, or to all of the space's, and moves the selected workspace to the other space. */
function SidebarWorkspacePicker({ workspaces, onPick }: SidebarWorkspacePickerProps) {
	const [open, setOpen] = useState(false);
	const personal = useContext(PersonalContext);
	const { workspace: current, space, spaces } = useDashboardStatus().scope;
	useShortcuts({ workspace: () => setOpen(shown => !shown) });
	const selected = workspaces.find(workspace => workspace.cwd === current);
	const allLabel = ALL_OF_SPACE[space];
	const label = selected ? (workspaceName(selected.cwdDisplay, personal) ?? selected.cwdDisplay) : allLabel;
	const pick = (cwd: string | null) => (): void => {
		if (cwd !== current) onPick(cwd);
	};
	const other = otherSpace(space);
	// The personal directory is Personal's home, so it never moves.
	const moveItem = selected && !spaces.isPersonalDir(selected.cwd) && {
		value: `Move to ${SPACE_LABELS[other]}`,
		icon: ArrowLeftRight,
		label: <span className="truncate">Move {label} to {SPACE_LABELS[other]}</span>,
		onSelect: () => void moveWorkspace(label, selected.cwd, space, other),
	};
	return (
		<CommandPicker
			trigger={selected ? label : "Workspaces"}
			control="sidebar.workspace"
			tooltip={selected?.cwdDisplay ?? allLabel}
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
					{ key: "all", items: [{ value: allLabel, label: allLabel, selected: current === null, onSelect: pick(null) }] },
					{
						key: "workspaces",
						heading: "Workspaces",
						items: workspaceItems(workspaces, current, personal, workspace => pick(workspace.cwd)()),
					},
					{ key: "move", items: moveItem ? [moveItem] : [] },
				],
			}}
			empty="No workspace matches."
		/>
	);
}

interface RosterProps {
	/** The space's workspaces, as {@link workspacesIn} lists them, which the picker offers. */
	workspaces: Workspace[];
	/** The sessions under the selected workspace that match `query`. */
	lists: SidebarSessions;
	/** The live and interrupted sessions of `lists` by workspace. */
	groups: WorkspaceGroup[];
	/** What the search field holds; it narrows `lists`. */
	query: string;
	onQuery: (query: string) => void;
	/** Pin session `sessionId`, or unpin it when it is pinned; the same function on every render. */
	onTogglePin: (sessionId: string) => void;
	/** Views on screen; their sessions' rows are highlighted, and marked while they share the screen with another pane. */
	open: View[];
	/** The space's scheduled sends. */
	scheduled: readonly ScheduledSend[];
	/** The scheduled send whose page is open, highlighted in its group; `null` for none. */
	scheduledOpen: string | null;
	onPickWorkspace: (cwd: string | null) => void;
}

/**
 * The roster: each workspace holds its live and interrupted sessions, the busy ones first, and Past lists the ended ones.
 * An ended session on screen that Past does not show, folded or beyond its page, shows under its workspace instead.
 */
export function Roster({ workspaces, lists, groups, query, onQuery, onTogglePin, open, scheduled, scheduledOpen, onPickWorkspace }: RosterProps) {
	const { start, dismissStart, openNewSession } = useDashboardActions();
	const { connected, starts: { resumeAll }, scope: { workspace } } = useDashboardStatus();
	const personal = useContext(PersonalContext);
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
	const folders = rosterFolders(groups, ended, open, { pastListed: pastOpen ? pastShown : 0, limit: GROUPS_SHOWN, all: allGroups, filtering });
	const hostRow = (host: SidebarSessions["running"][number], isPinned: boolean, badged: boolean) => (
		<HostRow key={host.instanceId} session={host} pinned={isPinned} placement={rowPlacement(open, { kind: "live", instanceId: host.instanceId, agentId: null })} showWorkspace={badged} onTogglePin={onTogglePin} />
	);
	const pastRow = (session: PastSession, isPinned: boolean, badged: boolean) => (
		<PastRow key={session.sessionId} session={session} pinned={isPinned} placement={rowPlacement(open, { kind: "past", sessionId: session.sessionId })} showWorkspace={badged} onTogglePin={onTogglePin} />
	);
	const hiddenPast = ended.length - pastShown;
	const nothing = pinned.hosts.length + pinned.past.length + folders.shown.reduce((sum, { group, under }) => sum + group.hosts.length + group.interrupted.length + under.length, 0) + ended.length === 0;
	return (
		<>
			<SidebarGroup className="gap-1 pt-4 pb-1">
				<div className="group/section flex h-6 min-w-0 items-center gap-0.5">
					<SidebarWorkspacePicker workspaces={workspaces} onPick={onPickWorkspace} />
					<span className="ml-auto flex shrink-0 items-center gap-0.5 pr-1.5">
						{!searchShown && (
							<Tooltip content="Search sessions" shortcut={shortcutLabels("sessionSearch")}>
								<SidebarGroupAction asChild className={cn("relative right-auto top-auto", REVEAL)}>
									<button type="button" aria-label="Search sessions" onClick={() => setSearching(true)}>
										<Search />
									</button>
								</SidebarGroupAction>
							</Tooltip>
						)}
						{interrupted.length > 0 && (
							<Tooltip content={resumingAll ? "Resuming…" : `Resume all ${interrupted.length} interrupted`} disabled={resumingAll || !connected}>
								<SidebarGroupAction asChild className="relative right-auto top-auto disabled:pointer-events-none disabled:opacity-50">
									<button
										type="button"
										aria-label={resumingAll ? "Resuming interrupted sessions" : "Resume all interrupted sessions"}
										disabled={resumingAll || !connected}
										onClick={() => start({ kind: "resume-all", sessionIds: interrupted.map(session => session.sessionId) })}
									>
										{resumingAll ? <Loader className="animate-spin" /> : <ListRestart />}
									</button>
								</SidebarGroupAction>
							</Tooltip>
						)}
					</span>
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
			{!filtering && <ScheduledGroup sends={scheduled} openId={scheduledOpen} showWorkspace={showWorkspace} open={!collapsed.has("scheduled")} onOpenChange={() => toggleGroup("scheduled")} />}
			{pinned.hosts.length + pinned.past.length > 0 && (
				<SidebarGroup collapsible open={!collapsed.has("pinned")} onOpenChange={() => toggleGroup("pinned")}>
					<SidebarGroupLabel icon={Pin}>{`${pinned.hosts.length + pinned.past.length} pinned`}</SidebarGroupLabel>
					<SidebarMenu aria-label="Pinned omp sessions" className="gap-px">
						{pinned.hosts.map(host => hostRow(host, true, showWorkspace))}
						{pinned.past.map(session => pastRow(session, true, showWorkspace))}
					</SidebarMenu>
				</SidebarGroup>
			)}
			{folders.shown.map(({ group, under }) => {
				const { cwd, cwdDisplay } = group.workspace;
				const name = workspaceName(cwdDisplay, personal) ?? cwdDisplay;
				const waiting = group.hosts.filter(needsYou).length;
				const key = `workspace:${cwd}`;
				const rows = group.hosts.length + group.interrupted.length + under.length;
				const newHere = (
					<SidebarGroupActions className={cn("opacity-0 transition-opacity group-hover/workspace:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100", rows === 0 ? "top-0" : "top-0.5")}>
						<Tooltip content={`New session in ${name}`} side="right">
							<SidebarGroupAction aria-label={`New session in ${name}`} onClick={() => openNewSession(cwd)}>
								<Plus />
							</SidebarGroupAction>
						</Tooltip>
					</SidebarGroupActions>
				);
				const unfolded = rows > 0 && !collapsed.has(key);
				const label = (
					<SidebarGroupLabel icon={unfolded ? FolderOpen : Folder} title={cwdDisplay} className="h-7 text-[13px] text-foreground/85 hover:text-foreground">
						{name}
						{waiting > 0 && (
							<span aria-label={sessionsWaiting(waiting)} className="min-w-4 shrink-0 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold tabular-nums text-primary-foreground">
								{waiting}
							</span>
						)}
					</SidebarGroupLabel>
				);
				if (rows === 0) {
					return (
						<SidebarGroup key={cwd} className="group/workspace py-0">
							{label}
							{newHere}
						</SidebarGroup>
					);
				}
				return (
					<SidebarGroup key={cwd} className="group/workspace py-0" collapsible open={!collapsed.has(key)} onOpenChange={() => toggleGroup(key)} headerActions={newHere}>
						{label}
						<SidebarMenu aria-label={`omp sessions in ${name}`} className="ml-[15px] w-auto gap-px border-l border-border pl-1">
							{group.hosts.map(host => hostRow(host, false, false))}
							{group.interrupted.map(session => pastRow(session, false, false))}
							{under.map(session => pastRow(session, false, false))}
						</SidebarMenu>
					</SidebarGroup>
				);
			})}
			{(folders.more > 0 || (allGroups && folders.matching > GROUPS_SHOWN)) && (
				<SidebarGroup className="py-0">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton icon={MoreHorizontal} className="text-muted-foreground" onClick={() => setAllGroups(all => !all)}>
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
