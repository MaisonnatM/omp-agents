import { Folder, Keyboard, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { RosterHost, View } from "../../src/shared/sessions";
import type { Routine } from "../../src/routines";
import type { UserTodoList } from "../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup, SidebarHeader, SidebarMenu } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { agentOn, yourMoveCount } from "../inbox-model";
import { projectName } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { inboxStore, ticketsStore } from "../reads";
import { hashForTickets, type SettingsRoute, SIDEBAR_TABS, type SidebarTab, type TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import type { SidebarSessions } from "../sessions";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { ticketGroups, ticketSection } from "../tickets-model";
import { CommandPicker } from "./command-picker";
import { SectionLink } from "./section-link";
import { useDashboardContext } from "./dashboard-context";
import { CalendarNav, type CalendarTabPage } from "./calendar/calendar-nav";
import { SessionList } from "./session-list";
import { SettingsNav } from "./settings/settings-nav";
import { workspaceItems } from "./workspace-picker";
import { TodoCategories } from "./todo/categories";
import type { KnownSessions } from "./todo/links";

/** The project the sidebar and the inbox are scoped to, by `cwd`; absent for all projects. */
const PROJECT_KEY = "omp-agents.sidebar-project";

/** The project `cwd` the sidebar and the inbox show, `null` for all projects, and its setter, which localStorage keeps. */
export function useProject(projects: { cwd: string }[]): [string | null, (cwd: string | null) => void] {
	const [stored, pick] = useStoredState<string | null>(PROJECT_KEY, raw => raw, cwd => cwd ?? "");
	// A stored project with no sessions left, or not yet loaded, shows all of them.
	return [projects.some(({ cwd }) => cwd === stored) ? stored : null, pick];
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
						items: workspaceItems(projects, current, project => pick(project.cwd)()),
					},
				],
			}}
			empty="No project matches."
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


/**
 * How the sidebar tabs fit its width, by container query: labels while they fit, then icons alone sharing the row.
 * Icons alone keep each name in the tooltip and for screen readers.
 * Each switch sits where the labels fit with counts on Inbox and Sessions and the list's margins; labels never fit beside their icons once both carry counts.
 */
const SIDEBAR_TAB_FIT = {
	five: {
		list: "@max-[23rem]/sidebar:self-stretch",
		tab: "@min-[23rem]/sidebar:[&>svg]:hidden @max-[23rem]/sidebar:flex-1 @max-[23rem]/sidebar:justify-center @max-[23rem]/sidebar:px-0.5",
		label: "@max-[23rem]/sidebar:sr-only",
	},
	six: {
		list: "@max-[26rem]/sidebar:self-stretch",
		tab: "@min-[26rem]/sidebar:[&>svg]:hidden @max-[26rem]/sidebar:flex-1 @max-[26rem]/sidebar:justify-center @max-[26rem]/sidebar:px-0.5",
		label: "@max-[26rem]/sidebar:sr-only",
	},
};


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
	/** omp is signed in to Linear, so the Tickets tab shows. */
	ticketsShown: boolean;
	/** The sidebar's tab, selected by the page or kept over the panes. */
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
	/** The settings section and workspace the Settings tab's links keep. */
	settingsRoute: SettingsRoute;
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
	ticketsShown,
	tab,
	onTab,
	userTodos,
	todoView,
	todoSessions,
	routines,
	calendarTab,
	settingsRoute,
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
	const { changeTodo: onTodoChange, connected } = useDashboardContext();
	const inboxRead = inboxStore.use(project).read;
	/** The count after a tab's label, and what it counts, for its accessible name. */
	const tabCounts: Partial<Record<SidebarTab, { count: number; meaning: string }>> = {
		sessions: { count: waiting, meaning: "waiting on you" },
		inbox: { count: inboxRead ? yourMoveCount(inboxRead.data, agentOn(hosts)) : 0, meaning: "your move" },
	};
	const selectedProject = projects.find(({ cwd }) => cwd === project);
	const newSessionLabel = selectedProject ? `New session in ${projectName(selectedProject.cwdDisplay) ?? selectedProject.cwdDisplay}` : "New session";
	const fit = ticketsShown ? SIDEBAR_TAB_FIT.six : SIDEBAR_TAB_FIT.five;
	return (
		<Tabs value={tab} onValueChange={value => onTab(value as SidebarTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="h-(--page-header-height) flex-row items-center justify-between gap-2 border-b border-border px-2 py-0">
				<h1 className="sr-only">omp sessions</h1>
				<ProjectPicker projects={projects} current={project} onPick={onPickProject} />
				<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
					<Button variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onShowSearch}>
						<Search />
					</Button>
				</Tooltip>
				<Tooltip content="Keyboard shortcuts" shortcut={shortcutLabels("help")} side="bottom">
					<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
						<Keyboard />
					</Button>
				</Tooltip>
				{toggle}
			</SidebarHeader>
			<SizeProvider size="compact">
				<TabsList aria-label="Sidebar" className={cn("mx-2 mt-2 max-w-[calc(100%-1rem)] self-start", fit.list)}>
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
				<SessionList
					lists={lists}
					query={query}
					onQuery={onQuery}
					onTogglePin={onTogglePin}
					open={open}
					showProject={project === null}
					newSessionOpen={newSessionOpen}
					newSessionLabel={newSessionLabel}
				/>
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
			<TabPanel value="settings" asChild>
				<SidebarContent>
					<SettingsNav route={settingsRoute} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
