import { AppWindow, Archive, CircleStop, Columns2, Copy, Ellipsis, Folder, GitPullRequest, Keyboard, ListRestart, Loader, Pin, PinOff, Play, Plus, Search, Settings } from "lucide-react";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import { type PastSession, type PullRequest, pullRequestUrl, type RosterHost, type Routine, type ShipProgress, type UserTodoList, type View } from "../../src/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	MenuItem,
	MenuLinkItem,
	MenuSeparator,
	MenuShortcut,
} from "@/components/ui/menu";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupActions,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { agentOn, yourMoveCount } from "../inbox-model";
import { age, hostLabel, modeOf, pastLabel, projectName, pullRequestsLabel, SPLIT_CLICK } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { inboxStore, ticketsStore } from "../reads";
import { hashForSettings, hashForTickets, type OpenMode, sameView, type TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import type { SidebarSessions } from "../sessions";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredKeys, useStoredState } from "../stored-state";
import { ticketGroups, ticketSection } from "../tickets-model";
import { CommandPicker } from "./command-picker";
import { useDashboardContext } from "./dashboard-context";
import { ShipStep } from "./ship-step";
import { CalendarNav, type CalendarTabPage } from "./calendar/calendar-nav";
import { StatusDot, statusLabel } from "./status-dot";
import { TodoCategories } from "./todo-categories";
import type { KnownSessions } from "./todo-links";

/** The muted facts after a session's name: the parts that apply, and a title listing its pull requests. */
function sessionFacts(parts: (string | false)[], pullRequests: PullRequest[]): { text: string; title?: string } | null {
	const text = parts.filter(part => part !== false).join(" · ");
	if (!text) return null;
	const title = pullRequests.map(pr => `${pr.repo}#${pr.number}`).join("\n");
	return { text, title: title || undefined };
}

function SessionRow({
	view,
	label,
	title,
	badge,
	ship,
	facts,
	when,
	dot,
	open,
	onOpen,
}: {
	view: View;
	label: string;
	title: string;
	badge: ReactNode;
	ship: ShipProgress | null;
	/** Muted facts after the ship step, joined already; `title` is the fuller list, such as each pull request. */
	facts: { text: string; title?: string } | null;
	when: number;
	dot?: ReactNode;
	open: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
}) {
	return (
		<Tooltip content={`${label}. ${title}. ${SPLIT_CLICK} to open in a split`} side="right">
			<SidebarMenuButton isActive={open} onClick={event => onOpen(view, modeOf(event))}>
				{dot}
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					{badge}
					<span className="truncate font-medium text-foreground">{label}</span>
					<ShipStep ship={ship} />
					{facts && (
						<span className="shrink-0 text-xs text-muted-foreground" title={facts.title}>
							{facts.text}
						</span>
					)}
					<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(when)}</span>
				</span>
			</SidebarMenuButton>
		</Tooltip>
	);
}

/** The project the sidebar and the inbox are scoped to, by `cwd`; absent for all projects. */
const PROJECT_KEY = "omp-agents.sidebar-project";
const COLLAPSED_GROUPS_KEY = "omp-agents.sidebar-collapsed-groups";

/** The project `cwd` the sidebar and the inbox show, `null` for all projects, and its setter, which localStorage keeps. */
export function useProject(projects: { cwd: string }[]): [string | null, (cwd: string | null) => void] {
	const [stored, pick] = useStoredState<string | null>(PROJECT_KEY, raw => raw, cwd => cwd ?? "");
	// A stored project with no sessions left, or not yet loaded, shows all of them.
	return [projects.some(({ cwd }) => cwd === stored) ? stored : null, pick];
}

/** The project a titled row ran in, before its title, shown only under all projects. An untitled row's label is already the project's name. */
function ProjectBadge({ cwdDisplay }: { cwdDisplay: string }) {
	const name = projectName(cwdDisplay);
	return name ? <Badge size="compact" className="shrink-0 self-center">{name}</Badge> : null;
}

interface RowMenuProps {
	view: View;
	/** The row's name, which the "More actions" button is labelled after. */
	label: string;
	/** `view` is on screen, which leaves out Open in split. */
	isOpen: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The row's `SidebarMenuButton`. */
	children: ReactElement;
	/** The row's own items, after Open and Open in split. */
	items?: ReactNode;
	style?: CSSProperties;
}

/** A sidebar row whose quick actions open on right-click and from its hover-revealed "More actions" button. */
export function RowMenu({ view, label, isOpen, onOpen, children, items, style }: RowMenuProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuItems = (
		<>
			<MenuItem onClick={() => onOpen(view, "replace")}>
				<AppWindow />
				Open
			</MenuItem>
			{!isOpen && (
				<MenuItem onClick={() => onOpen(view, "split")}>
					<Columns2 />
					Open in split
					<MenuShortcut>{SPLIT_CLICK}</MenuShortcut>
				</MenuItem>
			)}
			{items}
		</>
	);
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<SidebarMenuItem style={style} />}>
				{children}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<Tooltip content="More actions" forceOpen={menuOpen ? false : undefined}>
						<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${label}`} />}>
							<Ellipsis />
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
				</DropdownMenu>
			</ContextMenuTrigger>
			<ContextMenuContent>{menuItems}</ContextMenuContent>
		</ContextMenu>
	);
}

interface SessionItemsProps {
	row: { cwd: string; sessionId: string; pullRequests: PullRequest[]; tickets: string[] };
	pinned: boolean;
	onTogglePin: (sessionId: string) => void;
}

/** Items a running or past session's menu shares: pinning it, its pull requests and Linear issues, its workspace's settings, and copying its ids. */
function SessionItems({ row, pinned, onTogglePin }: SessionItemsProps) {
	return (
		<>
			<MenuItem onClick={() => onTogglePin(row.sessionId)}>
				{pinned ? <PinOff /> : <Pin />}
				{pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuSeparator />
			{row.pullRequests.map(pr => (
				<MenuLinkItem key={pullRequestUrl(pr)} href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
					<GitPullRequest />
					Open {pr.repo}#{pr.number}
				</MenuLinkItem>
			))}
			{row.tickets.map(id => (
				<MenuLinkItem key={id} href={hashForTickets(id)}>
					<PAGE_ICON.tickets />
					Open {id}
				</MenuLinkItem>
			))}
			<MenuLinkItem href={hashForSettings(row.cwd)}>
				<Settings />
				Workspace settings
			</MenuLinkItem>
			<MenuSeparator />
			<MenuItem onClick={() => void navigator.clipboard.writeText(row.cwd)}>
				<Folder />
				Copy path
			</MenuItem>
			<MenuItem onClick={() => void navigator.clipboard.writeText(row.sessionId)}>
				<Copy />
				Copy session ID
			</MenuItem>
		</>
	);
}
interface ProjectPickerProps {
	/** Directories sessions ran in, as {@link workspaces} lists them. */
	projects: { cwd: string; cwdDisplay: string }[];
	/** The selected project's `cwd`, or `null` for all projects. */
	current: string | null;
	onPick: (cwd: string | null) => void;
}

/** Scopes the roster to one directory's running and past sessions. */
function ProjectPicker({ projects, current, onPick }: ProjectPickerProps) {
	const [open, setOpen] = useState(false);
	useShortcuts({ project: () => setOpen(shown => !shown) });
	const selected = projects.find(project => project.cwd === current);
	const label = selected ? (projectName(selected.cwdDisplay) ?? selected.cwdDisplay) : "All projects";
	const pick = (cwd: string | null) => (): void => {
		if (cwd !== current) onPick(cwd);
	};
	return (
		<CommandPicker
			trigger={<span className="truncate">{label}</span>}
			icon={Folder}
			tooltip={selected?.cwdDisplay ?? "All projects"}
			shortcut="project"
			ariaLabel={`Show sessions from: ${label}`}
			className="min-w-0 font-semibold"
			search={{ label: "Search projects" }}
			width="md"
			open={open}
			onOpenChange={setOpen}
			list={{
				kind: "ready",
				groups: [
					{ key: "all", items: [{ value: "All projects", label: "All projects", selected: current === null, onSelect: pick(null) }] },
					{
						key: "projects",
						heading: "Projects",
						items: projects.map(project => ({
							value: project.cwd,
							keywords: [project.cwdDisplay],
							label: (
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{projectName(project.cwdDisplay) ?? project.cwdDisplay}</span>
									<span className="truncate text-xs text-muted-foreground">{project.cwdDisplay}</span>
								</span>
							),
							selected: project.cwd === current,
							onSelect: pick(project.cwd),
						})),
					},
				],
			}}
			empty="No project matches."
		/>
	);
}

interface SectionLinkProps {
	/** The page the section is on. */
	href: string;
	section: SectionTarget;
	/** The section a link last chose. */
	chosen: SectionTarget | null;
	title: string;
	label: string;
	count: number;
	/** Gets a new target each time, so choosing a section again scrolls back to it. */
	onChoose: (target: SectionTarget) => void;
}

/** A link to a section of a page, with its count. A plain click scrolls there; the page listens for `onChoose`. */
function SectionLink({ href, section, chosen, title, label, count, onChoose }: SectionLinkProps) {
	const isChosen = chosen?.id === section.id;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild isActive={isChosen}>
				<a
					href={href}
					aria-controls={section.id}
					aria-current={isChosen ? "location" : undefined}
					aria-label={label}
					onClick={event => {
						// Modified and middle clicks keep the link's own new-tab behavior.
						if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
						event.preventDefault();
						onChoose({ ...section });
					}}
				>
					{title}
				</a>
			</SidebarMenuButton>
			<SidebarMenuBadge aria-hidden>{count}</SidebarMenuBadge>
		</SidebarMenuItem>
	);
}

const navNote = (text: string) => <p className="px-2 py-1 text-xs text-muted-foreground">{text}</p>;

interface TicketsNavProps {
	target: SectionTarget | null;
	onTarget: (target: SectionTarget) => void;
}

/** The tickets page's status groups with their issue counts, each a link to its group on the page. */
function TicketsNav({ target, onTarget }: TicketsNavProps) {
	const { read, error } = ticketsStore.use();
	if (!read) return <SidebarGroup>{navNote(error ? `Cannot load the tickets: ${error}` : "Asking Linear for your issues…")}</SidebarGroup>;
	const groups = ticketGroups(read.data.tickets);
	if (groups.length === 0) return <SidebarGroup>{navNote("No issues assigned to you.")}</SidebarGroup>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Ticket groups">
				{groups.map(({ status, tickets: { length } }) => (
					<SectionLink
						key={status}
						href={hashForTickets(null)}
						section={ticketSection(status)}
						chosen={target}
						title={status}
						label={`${status}, ${length} issue${length === 1 ? "" : "s"}`}
						count={length}
						onChoose={section => {
							location.hash = hashForTickets(null);
							onTarget(section);
						}}
					/>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

const SIDEBAR_TABS = [
	{ value: "inbox", label: "Inbox", icon: PAGE_ICON.inbox },
	{ value: "tickets", label: "Tickets", icon: PAGE_ICON.tickets },
	{ value: "sessions", label: "Sessions", icon: PAGE_ICON.sessions },
	{ value: "todo", label: "Todo", icon: PAGE_ICON.todo },
	{ value: "calendar", label: "Calendar", icon: PAGE_ICON.calendar },
] as const;

/**
 * How the sidebar tabs fit its width, by container query: labels while they fit, then icons alone sharing the row.
 * Icons alone keep each name in the tooltip and for screen readers.
 * Each switch sits where the labels fit with counts on Inbox and Sessions and the list's margins; labels never fit beside their icons once both carry counts.
 */
const SIDEBAR_TAB_FIT = {
	four: {
		list: "@max-[19rem]/sidebar:self-stretch",
		tab: "@min-[19rem]/sidebar:[&>svg]:hidden @max-[19rem]/sidebar:flex-1 @max-[19rem]/sidebar:justify-center @max-[19rem]/sidebar:px-0.5",
		label: "@max-[19rem]/sidebar:sr-only",
	},
	five: {
		list: "@max-[22rem]/sidebar:self-stretch",
		tab: "@min-[22rem]/sidebar:[&>svg]:hidden @max-[22rem]/sidebar:flex-1 @max-[22rem]/sidebar:justify-center @max-[22rem]/sidebar:px-0.5",
		label: "@max-[22rem]/sidebar:sr-only",
	},
};

/** The sidebar's tab; the tickets, todo, and calendar tabs go with their pages, the sessions and inbox tabs with the panes. */
export type SidebarTab = (typeof SIDEBAR_TABS)[number]["value"];

interface RosterProps {
	/** Directories sessions ran in, as {@link workspaces} lists them. */
	projects: { cwd: string; cwdDisplay: string }[];
	/** The sessions tab's lists, under the selected project and matching `query`. */
	lists: SidebarSessions;
	/** Live sessions in the selected project that wait on your move, whatever the search field hides. */
	waiting: number;
	/** What the sessions tab's search field holds; it narrows `lists`. */
	query: string;
	onQuery: (query: string) => void;
	/** Pin session `sessionId`, or unpin it when it is pinned. */
	onTogglePin: (sessionId: string) => void;
	/** Views on screen, highlighted in the list. */
	open: View[];
	/** The new-session draft is open. */
	newSessionOpen: boolean;
	/** The settings page, for the open session's workspace. */
	settingsHref: string;
	settingsOpen: boolean;
	/** omp is signed in to Linear, so the Tickets tab shows. */
	ticketsShown: boolean;
	/** The sidebar's tab: the tickets, the todos, or the calendar with their pages, or the sessions or the inbox over the panes. */
	tab: SidebarTab;
	onTab: (tab: SidebarTab) => void;
	/** The Todo page's list, `null` until the server sends it. */
	userTodos: UserTodoList | null;
	/** The list the Todo page shows. */
	todoView: TodoListView;
	/** Unfiltered sessions, so the project picker does not hide a todo's linked session. */
	todoSessions: KnownSessions;
	routines: Routine[];
	/** The page under the Calendar tab that is open. */
	calendarTab: CalendarTabPage;
	/** The tickets section a sidebar link last chose. */
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	/** The Inbox tab's content. */
	inbox: ReactNode;
	/** The live sessions, which take a pull request's move while they work on it or ask about it. */
	hosts: RosterHost[];
	/** The selected project's `cwd`, or `null` for all projects. */
	project: string | null;
	onPickProject: (cwd: string | null) => void;
	onShowSearch: () => void;
	onShowShortcuts: () => void;
	/** The button that hides the sidebar, first in the header. */
	toggle: ReactNode;
}

export function Roster({
	projects,
	lists,
	waiting,
	query,
	onQuery,
	onTogglePin,
	open,
	newSessionOpen,
	settingsHref,
	settingsOpen,
	ticketsShown,
	tab,
	onTab,
	userTodos,
	todoView,
	todoSessions,
	routines,
	calendarTab,
	sectionTarget,
	onSectionTarget,
	inbox,
	hosts,
	project,
	onPickProject,
	onShowSearch,
	onShowShortcuts,
	toggle,
}: RosterProps) {
	const { open: onOpen, send, start, dismissStart, end: onEnd, openNewSession: onNewSession, changeTodo: onTodoChange, connected, starts } = useDashboardContext();
	const { resume, resumeAll } = starts;
	const [collapsed, toggleGroup] = useStoredKeys(COLLAPSED_GROUPS_KEY);
	const inboxRead = inboxStore.use(project).read;
	/** The count after a tab's label, and what it counts, for its accessible name. */
	const tabCounts: Partial<Record<SidebarTab, { count: number; meaning: string }>> = {
		sessions: { count: waiting, meaning: "waiting on you" },
		inbox: { count: inboxRead ? yourMoveCount(inboxRead.data, agentOn(hosts)) : 0, meaning: "your move" },
	};
	/** Continue past session `sessionId`, in the pane that shows it. */
	const onResume = (sessionId: string): void => {
		// The pane shows the resume's progress and failure, and the live session takes it over.
		onOpen({ kind: "past", sessionId }, "replace");
		start({ kind: "resume", sessionId });
	};
	const { pinned, running, idle, interrupted, ended } = lists;
	const resumingAll = resumeAll?.phase === "starting";
	const isOpen = (view: View): boolean => open.some(pane => sameView(pane, view));
	const selectedProject = projects.find(({ cwd }) => cwd === project);
	const newSessionLabel = selectedProject ? `New session in ${projectName(selectedProject.cwdDisplay) ?? selectedProject.cwdDisplay}` : "New session";
	/** The search field narrows the lists, so a group left empty hides rather than saying it has no sessions. */
	const filtering = query.trim() !== "";
	/** A past session's row; `isPinned` lists it under Pinned, where an interrupted one says so, as its own group does not. */
	const pastRow = (session: PastSession, isPinned: boolean) => {
		const pastView: View = { kind: "past", sessionId: session.sessionId };
		return (
			<RowMenu
				key={session.sessionId}
				view={pastView}
				label={pastLabel(session)}
				isOpen={isOpen(pastView)}
				onOpen={onOpen}
				items={
					<>
						{/* One resume runs at a time, as the pane's Resume button allows. */}
						<MenuItem disabled={resume?.phase === "starting"} onClick={() => onResume(session.sessionId)}>
							<Play />
							{resume?.phase === "starting" && resume.op.sessionId === session.sessionId ? "Resuming…" : "Resume"}
						</MenuItem>
						{session.interrupted && (
							<MenuItem onClick={() => send({ t: "dismiss-interrupted", sessionId: session.sessionId })}>
								<Archive />
								Move to past
							</MenuItem>
						)}
						<SessionItems row={session} pinned={isPinned} onTogglePin={onTogglePin} />
					</>
				}
			>
				<SessionRow
					view={pastView}
					label={pastLabel(session)}
					title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
					badge={project === null && session.title !== null ? <ProjectBadge cwdDisplay={session.cwdDisplay} /> : null}
					ship={session.ship}
					facts={sessionFacts([isPinned && session.interrupted && "interrupted", session.pullRequests.length > 0 && pullRequestsLabel(session.pullRequests)], session.pullRequests)}
					when={session.modifiedAt}
					open={isOpen(pastView)}
					onOpen={onOpen}
				/>
			</RowMenu>
		);
	};
	const hostRow = (host: RosterHost, isPinned: boolean) => {
		const hostView: View = { kind: "live", instanceId: host.instanceId, agentId: null };
		return (
			<RowMenu
				key={host.instanceId}
				view={hostView}
				label={hostLabel(host)}
				isOpen={isOpen(hostView)}
				onOpen={onOpen}
				items={
					<>
						<SessionItems row={host} pinned={isPinned} onTogglePin={onTogglePin} />
						{/* The server ends only what it controls: a dashboard session, or a terminal room shared writable. */}
						{host.control.phase === "live" && !host.control.readOnly && (
							<>
								<MenuSeparator />
								<MenuItem variant="destructive" onClick={() => onEnd(host.instanceId)}>
									<CircleStop />
									End session
								</MenuItem>
							</>
						)}
					</>
				}
			>
				<SessionRow
					view={hostView}
					label={hostLabel(host)}
					title={`${statusLabel(host.status)}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}`}
					badge={project === null && host.sessionName !== null ? <ProjectBadge cwdDisplay={host.cwdDisplay} /> : null}
					ship={host.ship}
					facts={sessionFacts(
						[host.source === "terminal" && !host.relayConnected && "relay offline", host.pullRequests.length > 0 && pullRequestsLabel(host.pullRequests)],
						host.pullRequests,
					)}
					when={host.startedAt}
					dot={<StatusDot status={host.status} />}
					open={isOpen(hostView)}
					onOpen={onOpen}
				/>
			</RowMenu>
		);
	};
	const fit = ticketsShown ? SIDEBAR_TAB_FIT.five : SIDEBAR_TAB_FIT.four;
	return (
		<Tabs value={tab} onValueChange={value => onTab(value as SidebarTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="flex-row items-center justify-between gap-2 px-2 pt-4">
				<h1 className="sr-only">omp sessions</h1>
				<ProjectPicker projects={projects} current={project} onPick={onPickProject} />
				<Tooltip content="Search sessions" shortcut={shortcutLabels("switcher")} side="bottom">
					<Button variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" aria-label="Search sessions" onClick={onShowSearch}>
						<Search />
					</Button>
				</Tooltip>
				<Tooltip content="Keyboard shortcuts" shortcut={shortcutLabels("help")} side="bottom">
					<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
						<Keyboard />
					</Button>
				</Tooltip>
				<Tooltip content="Settings" shortcut={shortcutLabels("settings")} side="bottom">
					<Button asChild variant="ghost" size="icon-compact" active={settingsOpen} className="shrink-0 text-muted-foreground">
						<a href={settingsHref} aria-label="Settings" aria-current={settingsOpen ? "page" : undefined}>
							<Settings />
						</a>
					</Button>
				</Tooltip>
				{toggle}
			</SidebarHeader>
			<SizeProvider size="compact">
				<TabsList aria-label="Sidebar" className={cn("mx-2 max-w-[calc(100%-1rem)] self-start", fit.list)}>
					{SIDEBAR_TABS.filter(({ value }) => ticketsShown || value !== "tickets").map(({ value, label, icon }) => {
						const counted = tabCounts[value];
						const badge = counted && counted.count > 0 ? counted : undefined;
						return (
							<TabItem
								key={value}
								value={value}
								label={label}
								icon={icon}
								badge={badge?.count}
								aria-label={badge && `${label}, ${badge.count} ${badge.meaning}`}
								className={cn("px-2", fit.tab)}
								labelClassName={fit.label}
								shortcut={shortcutLabels(value)}
							/>
						);
					})}
				</TabsList>
			</SizeProvider>
			{!connected && (
				<p className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
			<TabPanel value="sessions" forceMount className={tab === "sessions" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
				<SidebarGroup className="gap-1 pb-0">
					<SidebarMenu aria-label="Start a session">
						<SidebarMenuItem>
							<Tooltip content={newSessionLabel} shortcut={shortcutLabels("newSession")} side="right">
								<SidebarMenuButton icon={Plus} isActive={newSessionOpen} aria-current={newSessionOpen ? "page" : undefined} onClick={onNewSession}>
									<span className="truncate">{newSessionLabel}</span>
								</SidebarMenuButton>
							</Tooltip>
						</SidebarMenuItem>
					</SidebarMenu>
					<label className="relative block">
						<Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<SidebarInput
							type="search"
							aria-label="Filter the sidebar's sessions"
							placeholder="Search sessions"
							value={query}
							onChange={event => onQuery(event.target.value)}
							onKeyDown={event => {
								if (event.key !== "Escape") return;
								onQuery("");
								event.currentTarget.blur();
							}}
							className="pl-8"
						/>
					</label>
				</SidebarGroup>
				<SidebarContent>
					{filtering && pinned.hosts.length + pinned.past.length + idle.length + running.length + interrupted.length + ended.length === 0 && (
						<p className="px-4 py-2 text-xs text-muted-foreground">{`No sessions match “${query.trim()}”`}</p>
					)}
					{pinned.hosts.length + pinned.past.length > 0 && (
						<SidebarGroup collapsible open={!collapsed.has("pinned")} onOpenChange={() => toggleGroup("pinned")}>
							<SidebarGroupLabel>{`${pinned.hosts.length + pinned.past.length} pinned`}</SidebarGroupLabel>
							<SidebarMenu aria-label="Pinned omp sessions">
								{pinned.hosts.map(host => hostRow(host, true))}
								{pinned.past.map(session => pastRow(session, true))}
							</SidebarMenu>
						</SidebarGroup>
					)}
					{idle.length > 0 && (
						<SidebarGroup collapsible open={!collapsed.has("idle")} onOpenChange={() => toggleGroup("idle")}>
							<SidebarGroupLabel>{`${idle.length} idle`}</SidebarGroupLabel>
							<SidebarMenu aria-label="Idle omp sessions">{idle.map(host => hostRow(host, false))}</SidebarMenu>
						</SidebarGroup>
					)}
					{(!filtering || running.length > 0) && (
						<SidebarGroup collapsible open={!collapsed.has("running")} onOpenChange={() => toggleGroup("running")}>
							<SidebarGroupLabel>
								{running.length > 0 ? `${running.length} running` : pinned.hosts.length + idle.length > 0 ? "No other sessions running" : "No sessions"}
							</SidebarGroupLabel>
							<SidebarMenu aria-label="Running omp sessions">
								{running.map(host => hostRow(host, false))}
							</SidebarMenu>
						</SidebarGroup>
					)}
					{interrupted.length > 0 && (
						<SidebarGroup collapsible open={!collapsed.has("interrupted")} onOpenChange={() => toggleGroup("interrupted")}>
							<SidebarGroupLabel>{`${interrupted.length} interrupted`}</SidebarGroupLabel>
							{/* The action's props carry no disabled, so it styles a native button that does. */}
							<SidebarGroupActions>
								<Tooltip content={resumingAll ? "Resuming…" : "Resume all"}>
									{resumingAll || !connected ? (
										<span className="inline-flex">
											<SidebarGroupAction asChild className="disabled:pointer-events-none disabled:opacity-50">
												<button
													type="button"
													aria-label={resumingAll ? "Resuming interrupted sessions" : "Resume all interrupted sessions"}
													disabled
													onClick={() => start({ kind: "resume-all", sessionIds: interrupted.map(session => session.sessionId) })}
												>
													{resumingAll ? <Loader className="animate-spin" /> : <ListRestart />}
												</button>
											</SidebarGroupAction>
										</span>
									) : (
										<SidebarGroupAction asChild className="disabled:pointer-events-none disabled:opacity-50">
											<button
												type="button"
												aria-label="Resume all interrupted sessions"
												onClick={() => start({ kind: "resume-all", sessionIds: interrupted.map(session => session.sessionId) })}
											>
												<ListRestart />
											</button>
										</SidebarGroupAction>
									)}
								</Tooltip>
							</SidebarGroupActions>
							{resumeAll?.phase === "failed" && (
								<p role="alert" className="mx-2 mb-1 flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
									<span className="min-w-0 flex-1">{resumeAll.error}</span>
									<button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => dismissStart("resume-all")}>
										Dismiss
									</button>
								</p>
							)}
							<SidebarMenu aria-label="Interrupted omp sessions">
								{interrupted.map(session => pastRow(session, false))}
							</SidebarMenu>
						</SidebarGroup>
					)}
					{(!filtering || ended.length > 0) && (
						<SidebarGroup collapsible open={!collapsed.has("past")} onOpenChange={() => toggleGroup("past")}>
							<SidebarGroupLabel>{ended.length === 0 ? "No past sessions" : `${ended.length} past`}</SidebarGroupLabel>
							<SidebarMenu aria-label="Past omp sessions">{ended.map(session => pastRow(session, false))}</SidebarMenu>
						</SidebarGroup>
					)}
				</SidebarContent>
			</TabPanel>
			<TabPanel value="inbox" asChild>
				<SidebarContent>
					{inbox}
				</SidebarContent>
			</TabPanel>
			<TabPanel value="tickets" asChild>
				<SidebarContent>
					<TicketsNav target={sectionTarget} onTarget={onSectionTarget} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="todo" asChild>
				<SidebarContent>
					<TodoCategories list={userTodos} view={todoView} disabled={!connected} onChange={onTodoChange} sessions={todoSessions} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="calendar" asChild>
				<SidebarContent>
					<CalendarNav routines={routines} current={calendarTab} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
