/** The left sidebar's tabbed roster: sessions, pull requests, tickets, todos, notes, and more, under the workspace picker. */
import { Folder, Keyboard } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { RosterHost, View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import type { UserNoteList } from "../../src/user-notes-shared";
import type { UserTodoList } from "../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup, SidebarHeader, SidebarMenu } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { agentOn } from "../../src/shared/moves";
import { activityControl } from "../activity";
import { yourMoveCount } from "../pull-requests-model";
import { folderName } from "../labels";
import { pullRequestsStore, ticketsStore } from "../reads";
import { hashForTickets, type NotesListView, type SettingsRoute, type SidebarPanel, type SidebarTab, type TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import type { SidebarSessions } from "../sessions";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { panelOnBar, TAB_ROWS, tabShortcutLabels } from "../sidebar-tabs";
import { ticketGroups, ticketSection } from "../tickets-model";
import { CommandPicker } from "./command-picker";
import { SectionLink } from "./section-link";
import { BotsNav } from "./bots/bots-nav";
import { type BotRow, botsNeedingYou } from "../bots-model";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { CalendarNav } from "./calendar/calendar-nav";
import { EmailNav } from "./email/email-nav";
import { NotesNav } from "./notes/nav";
import { SessionList } from "./session-list";
import { SettingsNav } from "./settings/settings-nav";
import { workspaceItems } from "./workspace-picker";
import { TodoCategories } from "./todo/categories";
import type { KnownSessions } from "./todo/links";

interface SidebarWorkspacePickerProps {
	/** The workspaces, as {@link listWorkspaces} lists them. */
	workspaces: Workspace[];
	/** The selected workspace's `cwd`, or `null` for all workspaces. */
	current: string | null;
	onPick: (cwd: string | null) => void;
}

/** Scopes the roster to one directory's running and past sessions. */
function SidebarWorkspacePicker({ workspaces, current, onPick }: SidebarWorkspacePickerProps) {
	const [open, setOpen] = useState(false);
	useShortcuts({ workspace: () => setOpen(shown => !shown) });
	const selected = workspaces.find(workspace => workspace.cwd === current);
	const label = selected ? (folderName(selected.cwdDisplay) ?? selected.cwdDisplay) : "All workspaces";
	const pick = (cwd: string | null) => (): void => {
		if (cwd !== current) onPick(cwd);
	};
	return (
		<CommandPicker
			trigger={<span className="truncate">{label}</span>}
			icon={Folder}
			control="sidebar.workspace"
			tooltip={selected?.cwdDisplay ?? "All workspaces"}
			shortcut="workspace"
			ariaLabel={`Show sessions from: ${label}`}
			className="min-w-0 font-semibold"
			search={{ label: "Search workspaces" }}
			width="md"
			open={open}
			onOpenChange={setOpen}
			list={{
				kind: "ready",
				groups: [
					{ key: "all", items: [{ value: "All workspaces", label: "All workspaces", selected: current === null, onSelect: pick(null) }] },
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
				{groups.map(({ status, count: length }) => (
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

/**
 * How the sidebar tabs fit its width, through container queries: labels while they fit, then icons alone, the row only as
 * wide as its tabs. Icons alone keep each name in the tooltip and for screen readers. The width fits the bar's tabs, with
 * room for counts on Pull requests and Sessions and the list's margins.
 */
const SIDEBAR_TAB_FIT = {
	tab: "@min-[26rem]/sidebar:[&>svg]:hidden",
	label: "@max-[26rem]/sidebar:sr-only",
};

interface RosterProps {
	/** The workspaces, as {@link listWorkspaces} lists them. */
	workspaces: Workspace[];
	/** The sessions tab's lists, under the selected workspace and matching `query`. */
	lists: SidebarSessions;
	/** Live sessions in the selected workspace that wait on your move, whatever the search field hides. */
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
	/** The scheduled send whose page is open, `null` for none. */
	scheduledOpen: string | null;
	/** Every Bot's row, whatever the workspace, the most recent conversation first; `null` until the server sends the Bots. */
	bots: readonly BotRow[] | null;
	/** The Bot whose page is open, `null` for the New Bot form, `undefined` while the gallery, another page, or the panes show. */
	botsOpen: string | null | undefined;
	/** The shown tabs the bar draws, in order, which the position keys count. */
	tabs: readonly SidebarTab[];
	/** The sidebar's panel, selected by the page or kept over the panes. */
	tab: SidebarPanel;
	onTab: (tab: SidebarTab) => void;
	/** The Todo page's list, `null` until the server sends it. */
	userTodos: UserTodoList | null;
	/** The list the Todo page shows. */
	todoView: TodoListView;
	/** Unfiltered sessions, so the workspace picker does not hide a todo's linked session. */
	todoSessions: KnownSessions;
	/** The Notes page's list, `null` until the server sends it. */
	userNotes: UserNoteList | null;
	/** The list the Notes page shows. */
	notesView: NotesListView;
	/** The Calendar page is open. */
	calendarOpen: boolean;
	/** The settings section and workspace the sidebar's settings links keep. */
	settingsRoute: SettingsRoute;
	/** The tickets section a sidebar link last chose. */
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	/** The Pull requests tab's content. */
	pullRequestsTab: ReactNode;
	/** The live sessions, which take a pull request's move while they work on it or ask about it. */
	hosts: RosterHost[];
	/** The selected workspace's `cwd`, or `null` for all workspaces. */
	workspace: string | null;
	onPickWorkspace: (cwd: string | null) => void;
	onShowShortcuts: () => void;
}

export function Roster({
	workspaces,
	lists,
	waiting,
	query,
	onQuery,
	onTogglePin,
	open,
	newSessionOpen,
	scheduledOpen,
	bots,
	botsOpen,
	tabs,
	tab,
	onTab,
	userTodos,
	todoView,
	todoSessions,
	userNotes,
	notesView,
	calendarOpen,
	settingsRoute,
	sectionTarget,
	onSectionTarget,
	pullRequestsTab,
	hosts,
	workspace,
	onPickWorkspace,
	onShowShortcuts,
}: RosterProps) {
	const { changeTodo: onTodoChange } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const pullRequestRead = pullRequestsStore.use(workspace).read;
	/** The count after a tab's label, and what it counts, for its accessible name. */
	const tabCounts: Partial<Record<SidebarTab, { count: number; meaning: string }>> = {
		sessions: { count: waiting, meaning: "waiting on you" },
		bots: { count: bots ? botsNeedingYou(bots) : 0, meaning: "waiting on you" },
		"pull-requests": { count: pullRequestRead ? yourMoveCount(pullRequestRead.data, agentOn(hosts)) : 0, meaning: "your move" },
	};
	const selectedWorkspace = workspaces.find(({ cwd }) => cwd === workspace);
	const newSessionLabel = selectedWorkspace ? `New session in ${folderName(selectedWorkspace.cwdDisplay) ?? selectedWorkspace.cwdDisplay}` : "New session";
	return (
		<Tabs value={tab} onValueChange={value => onTab(value as SidebarTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="h-(--page-header-height) flex-row items-center justify-between gap-2 border-b border-border px-2 py-0">
				<h1 className="sr-only">omp sessions</h1>
				<SidebarWorkspacePicker workspaces={workspaces} current={workspace} onPick={onPickWorkspace} />
				<Tooltip content="Keyboard shortcuts" shortcut={shortcutLabels("help")} side="bottom">
					<Button {...activityControl("shortcuts.open")} variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
						<Keyboard />
					</Button>
				</Tooltip>
				{/* The sidebar's toggle rides over this corner, from `DashboardSidebar`, so it can glide to the strip a hidden sidebar leaves. */}
				<span aria-hidden className="size-7 shrink-0" />
			</SidebarHeader>
			{tabs.length > 0 && panelOnBar(tab) && (
				<SizeProvider size="compact">
					<TabsList aria-label="Sidebar" className="mx-2 mt-2 max-w-[calc(100%-1rem)] self-start">
						{tabs.map(value => {
							const { label, icon } = TAB_ROWS[value];
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
									className={cn("px-2", SIDEBAR_TAB_FIT.tab)}
									labelClassName={SIDEBAR_TAB_FIT.label}
									shortcut={tabShortcutLabels(value, tabs)}
								/>
							);
						})}
					</TabsList>
				</SizeProvider>
			)}
			{!connected && (
				<p className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
			<TabPanel value="sessions" forceMount className={tab === "sessions" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
				<SessionList
					lists={lists}
					query={query}
					onQuery={onQuery}
					onTogglePin={onTogglePin}
					open={open}
					showWorkspace={workspace === null}
					newSessionOpen={newSessionOpen}
					scheduledOpen={scheduledOpen}
					newSessionLabel={newSessionLabel}
				/>
			</TabPanel>
			<TabPanel value="bots" className="flex min-h-0 flex-1 flex-col">
				<BotsNav rows={bots} openId={botsOpen} />
			</TabPanel>
			<TabPanel value="pull-requests" asChild>
				<SidebarContent>
					{pullRequestsTab}
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
			<TabPanel value="notes" asChild>
				<SidebarContent>
					<NotesNav list={userNotes} view={notesView} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="calendar" asChild>
				<SidebarContent>
					<CalendarNav open={calendarOpen} workspace={workspace} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="email" asChild>
				<SidebarContent>
					<EmailNav workspace={workspace} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="settings" asChild>
				<SidebarContent>
					<SettingsNav route={settingsRoute} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
