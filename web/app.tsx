import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { QUICK_TODO_EVENT } from "../src/server/address";
import { callable, signedIn } from "../src/shared/accounts";
import type { UserTodoList } from "../src/user-todos-shared";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { DashboardContext } from "./components/dashboard-context";
import { FileDialog } from "./components/file-dialog";
import { InboxIndex, InboxNav } from "./components/inbox/inbox-nav";
import { InboxPage } from "./components/inbox/inbox-page";
import { PullRequestPage } from "./components/inbox/pr-page";
import { NewSession } from "./components/new-session";
import { Pane } from "./components/pane";
import { NO_PLANS, Plans } from "./components/plan-usage";
import { Roster, useProject } from "./components/roster";
import { SessionDetails } from "./components/session-details";
import { SettingsPage } from "./components/settings/settings-page";
import type { SettingsTab } from "./components/settings/settings-nav";
import { CommandPalette } from "./components/command-palette/command-palette";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, SidebarToggle, useSidebarPanels } from "./components/sidebar-panel";
import { StatusBar } from "./components/status-bar";
import { SplitResizeHandle, splitAt, useSplitRatio } from "./components/split-resize-handle";
import { RoutinesPage } from "./components/routines/routines-page";
import { CalendarPage } from "./components/calendar/calendar-page";
import { ChangesPage } from "./components/changes/changes-page";
import { TicketsDisconnected, TicketsPage } from "./components/tickets/tickets-page";
import { subjectOf } from "./components/subject";
import { TodoPage } from "./components/todo/page";
import { ActivityVisibility, HIDE_THINKING_KEY, HIDE_TOOL_CALLS_KEY, ToolsExpanded } from "./components/transcript";
import { documentTitle } from "./document-title";
import { SPLIT_CLICK } from "./labels";
import { inboxStore, integrationsStore, UNREAD } from "./reads";
import {
	adjacentSession,
	closePane,
	endSession,
	focusedView,
	hashForNewSession,
	hashForView,
	type Page,
	sameView,
	type SidebarTab,
	type TodoListView,
} from "./routing";
import type { SectionTarget } from "./section";
import { paletteReducer } from "./command-palette";
import { defaultCwd, discoverableSessions, listedViews, projectSession, projectSwitch, searchSessions, sidebarSessions, waitingCount, workspaces } from "./sessions";
import { type ShortcutHandlers, type ShortcutId, useShortcuts } from "./shortcuts";
import { startOf } from "./starts";
import { PINNED_SESSIONS_KEY, useStoredKeys, useStoredState } from "./stored-state";
import { quickAddTodo } from "./todo-quick-add";
import { localDay } from "./days";
import { CheckoutVersion } from "./use-git-checkout";
import { useDashboard } from "./use-dashboard";

/** The sidebar tab that goes with each page; the panes keep the one you chose. A session's changes go with the sessions. */
const PAGE_TAB: Partial<Record<Page["kind"], SidebarTab>> = { inbox: "inbox", tickets: "tickets", todo: "todo", calendar: "calendar", routines: "calendar", settings: "settings", changes: "sessions" };

const TAB_PAGE: Record<Exclude<SidebarTab, "sessions" | "settings">, Page> = {
	inbox: { kind: "inbox", target: null },
	tickets: { kind: "tickets", target: null },
	todo: { kind: "todo", list: { kind: "all" } },
	calendar: { kind: "calendar" },
};

function EmptyState({ rosterError }: { rosterError: string | null }) {
	return (
		<section className="m-auto w-full min-w-0 max-w-lg space-y-3 p-8 text-sm">
			<h2 className="text-base font-semibold">No omp sessions are published</h2>
			<p>
				Sessions publish themselves to the local Collab registry when <code>collab.autoStart</code> is <code>control</code>{" "}
				(or <code>view</code> for read-only):
			</p>
			<pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
				omp config set collab.autoStart control
			</pre>
			<p>
				Only sessions started after that setting changed appear here. Restart sessions that were already running, or
				run <code>/new</code> or <code>/collab</code> inside them. Or start one here with the <strong>+</strong> next to
				the session list.
			</p>
			{rosterError && <p className="text-red-600 dark:text-red-400">Registry error: {rosterError}</p>}
		</section>
	);
}

/** What a new session for top-level todo `todoId` starts with: its title, then its notes. `null` while the list names no such todo. */
function todoSeed(list: UserTodoList | null, todoId: string | null): { text: string; prompt: string } | null {
	const todo = todoId === null ? undefined : list?.todos.find(({ id }) => id === todoId);
	if (!todo) return null;
	const body = todo.body.trim();
	return { text: todo.text, prompt: body ? `${todo.text}\n\n${body}` : todo.text };
}

export function App() {
	const { state, page, send, open, focus, show, navigate, openNewSession, dismissStart, start, changeTodo } = useDashboard();
	const launch = startOf(state.starts, "new");
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const resumeAll = startOf(state.starts, "resume-all");
	const sidebars = useSidebarPanels();
	// Temporary workspaces remain in raw sessions; only discoverable sessions enter the project/sidebar view.
	const all = { hosts: state.hosts, past: state.past };
	const visible = useMemo(() => discoverableSessions(all.hosts, all.past), [all.hosts, all.past]);
	const projects = useMemo(() => workspaces(visible.hosts, visible.past), [visible]);
	const [project, pickProject] = useProject(projects);
	// Keeps the Inbox tab's count current on every page. Until the sessions are listed, the saved project reads as all projects.
	inboxStore.usePolling(project, state.listed);
	const [pinned, togglePin] = useStoredKeys(PINNED_SESSIONS_KEY);
	const { started } = state;
	useEffect(() => {
		if (!started) return;
		const next = projectSwitch(project, started.cwd);
		if (next !== null) pickProject(next);
	}, [started]);
	const { layout } = state;
	/** The pull request whose details the main area shows; `#inbox` alone shows the inbox page, with its sections in the sidebar. */
	const inboxTarget = page?.kind === "inbox" ? page.target : null;
	/** The inbox page lists the pull requests itself, so the sidebar's inbox tab shows its sections then. */
	const onInboxPage = page?.kind === "inbox" && !inboxTarget;
	const view = focusedView(layout);
	const viewHost = view?.kind === "live" ? all.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? all.past.find(s => s.sessionId === view.sessionId) : undefined;
	const viewLastHost = view?.kind === "live" ? state.lastHosts.get(view.instanceId) ?? null : null;
	const title = documentTitle(page ?? null, view, viewHost ?? viewLastHost, viewPast ?? null);
	useEffect(() => {
		document.title = title;
	}, [title]);
	const viewSession = viewHost ?? viewPast;
	const viewCwd = viewSession?.cwd;
	const [switches, setSwitches] = useState(0);
	const checkout = viewSession ? { dir: viewSession.worktree ?? viewSession.cwd, sessionId: viewSession.sessionId, working: viewHost?.status === "working" } : null;
	const split = layout.panes.length > 1;
	const [columns, setColumns] = useSplitRatio("columns");
	const [rows, setRows] = useSplitRatio("rows");
	const maximized = layout.maximized && !page;
	const [sessionQuery, setSessionQuery] = useState("");
	const projectLists = useMemo(() => sidebarSessions(visible.hosts, visible.past, project, pinned), [visible, project, pinned]);
	const defaultWorkspace = defaultCwd(view, visible.hosts, visible.past, project);
	const lists = useMemo(() => searchSessions(projectLists, sessionQuery), [projectLists, sessionQuery]);
	const listed = useMemo(() => listedViews(lists), [lists]);
	// The live rows of `listed`, whose order ending a session moves its panes along.
	const listedHosts = listed.flatMap(view => (view.kind === "live" ? view.instanceId : []));
	const latest = useRef({ layout, listedHosts, sidebars });
	latest.current = { layout, listedHosts, sidebars };
	const endHost = useCallback((instanceId: string): void => {
		send({ t: "end", instanceId });
		show(endSession(latest.current.layout, instanceId, latest.current.listedHosts));
	}, [send, show]);
	const [filePath, setFilePath] = useState<string | null>(null);
	const dashboard = useMemo(
		() => ({ send, open, focus, start, dismissStart, openNewSession, changeTodo, end: endHost, openFile: setFilePath, connected: state.connected, starts: { fork, resume, quick, resumeAll } }),
		[send, open, focus, start, dismissStart, openNewSession, changeTodo, endHost, state.connected, fork, resume, quick, resumeAll],
	);
	const onPaneLayout = useCallback((index: number, kind: "max" | "close") => {
		const current = latest.current.layout;
		show(kind === "max" ? { ...current, focus: index, maximized: !current.maximized } : closePane(current, index));
	}, [show]);
	/** The view whose details the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const detailsView = page || (split && !maximized) ? null : view;
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const toggleRight = useCallback(() => toggleSidebar("right"), [toggleSidebar]);
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);

	const switchProject = (cwd: string | null): void => {
		pickProject(cwd);
		// A page such as the tickets stays; only the panes follow the sidebar into the project.
		const next = page ? null : projectSession(cwd, visible.hosts, viewCwd);
		if (next) open(next, "replace");
	};
	const settingsPage: Page = { kind: "settings", cwd: page?.kind === "settings" ? page.cwd : viewCwd || null };
	const [settingsTab, setSettingsTab] = useState<SettingsTab>("analytics");
	useEffect(() => {
		if (page?.kind !== "settings") setSettingsTab("analytics");
	}, [page?.kind]);
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [hideTools, setHideTools] = useStoredState(HIDE_TOOL_CALLS_KEY, raw => raw === "true");
	const [hideThinking, setHideThinking] = useStoredState(HIDE_THINKING_KEY, raw => raw === "true");
	const toggleHideTools = useCallback(() => setHideTools(value => !value), [setHideTools]);
	const toggleHideThinking = useCallback(() => setHideThinking(value => !value), [setHideThinking]);
	const activityVisibility = useMemo(
		(): ActivityVisibility => ({ hideTools, hideThinking, toggleTools: toggleHideTools, toggleThinking: toggleHideThinking }),
		[hideTools, hideThinking, toggleHideTools, toggleHideThinking],
	);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [palette, dispatchPalette] = useReducer(paletteReducer, null);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const linear = integrationsStore.usePolling().read?.data.integrations.linear ?? null;
	/** The Tickets tab and its shortcut show once omp holds a sign-in to Linear, even one Linear refuses, which the tickets page then offers to reconnect. */
	const ticketsShown = linear !== null && signedIn(linear.connection);
	/** The dashboard reads and writes Linear: the tickets page lists issues, the Todo page creates them, and the Calendar shows their due days. */
	const linearCallable = linear !== null && callable(linear.connection);
	/** The tab the sidebar shows over the panes: `#inbox` picks the inbox, and it stays while you work in the panes until you choose Sessions. */
	const onInbox = page?.kind === "inbox";
	const [paneTab, setPaneTab] = useState<"sessions" | "inbox">(onInbox ? "inbox" : "sessions");
	const [wasOnInbox, setWasOnInbox] = useState(onInbox);
	if (onInbox !== wasOnInbox) {
		setWasOnInbox(onInbox);
		if (onInbox) setPaneTab("inbox");
	}
	const tab: SidebarTab = (page && !(page.kind === "tickets" && !ticketsShown) && PAGE_TAB[page.kind]) || paneTab;
	const routedTodoList = page?.kind === "todo" ? page.list : null;
	/** The list the Todo page shows; a category another window removed shows every todo. */
	const todoView: TodoListView =
		routedTodoList === null || (routedTodoList.kind === "category" && !state.userTodos?.categories.some(({ id }) => id === routedTodoList.id))
			? { kind: "all" }
			: routedTodoList;
	/** The desktop shell's quick-capture shortcut opens the command palette on Create todo. */
	useEffect(() => {
		const open = (): void => dispatchPalette({ type: "open", view: "createTodo" });
		window.addEventListener(QUICK_TODO_EVENT, open);
		return () => window.removeEventListener(QUICK_TODO_EVENT, open);
	}, []);
	/** The routine the Routines page shows; one another window deleted shows the list. */
	const routinesTarget = page?.kind === "routines" && state.routines.some(({ id }) => id === page.target) ? page.target : null;
	const showTab = (next: SidebarTab): void => {
		if (next === "settings") return navigate(settingsPage);
		if (next !== "sessions") return navigate(TAB_PAGE[next]);
		setPaneTab("sessions");
		show(layout);
	};
	const step = (by: 1 | -1): boolean | void => {
		const next = adjacentSession(listed, view, by);
		if (next) open(next, "replace");
		else if (!listed.length) return false;
	};
	/** What the page's shortcuts run, and the command palette's commands. */
	const handlers: ShortcutHandlers = {
		help: () => setShortcutsOpen(open => !open),
		switcher: () => dispatchPalette(palette ? { type: "close" } : { type: "open" }),
		newSession: openNewSession,
		previousSession: () => step(-1),
		nextSession: () => step(1),
		tools: () => setToolsExpanded(expanded => !expanded),
		hideTools: toggleHideTools,
		hideThinking: toggleHideThinking,
		sessionsSidebar: () => toggleSidebar("left"),
		detailsSidebar: () => {
			if (!detailsView) return false;
			toggleSidebar("right");
		},
		settings: () => {
			if (page?.kind === "settings") show(layout);
			else navigate(settingsPage);
		},
		inbox: () => {
			if (onInboxPage) return;
			showTab("inbox");
		},
		tickets: () => {
			if (!ticketsShown) return false;
			if (page?.kind === "tickets") return;
			showTab("tickets");
		},
		sessions: () => {
			if (tab === "sessions" && !page) return;
			showTab("sessions");
		},
		todo: () => {
			if (page?.kind === "todo") return;
			showTab("todo");
		},
		calendar: () => {
			if (page?.kind === "calendar") return;
			showTab("calendar");
		},
		routines: () => {
			if (page?.kind === "routines") return false;
			navigate({ kind: "routines", target: null });
		},
		restore: () => {
			if (!maximized) return false;
			show({ ...layout, maximized: false });
		},
	};
	useShortcuts(handlers);
	/** Commands that would do nothing now. */
	const unavailable = new Set<ShortcutId>([...(ticketsShown ? [] : ["tickets" as const]), ...(detailsView ? [] : ["detailsSidebar" as const])]);

	const panes = (): ReactNode => {
		if (layout.panes.length > 0) {
			return (
				<div
					className="relative grid h-full min-h-0 gap-px bg-border"
					style={{
						gridTemplateColumns: split ? `${splitAt(columns)} minmax(0, 1fr)` : "minmax(0, 1fr)",
						gridTemplateRows: layout.panes.length > 2 ? `${splitAt(rows)} minmax(0, 1fr)` : "minmax(0, 1fr)",
					}}
				>
					{layout.panes.map((pane, index) => (
						// Keyed by view: moving to another cell keeps a pane's draft and scroll; another view resets them.
						// A maximized pane covers the whole grid; the rest stay mounted, at their size, under it.
						<Pane
							key={hashForView(pane)}
							view={pane}
							index={index}
							count={layout.panes.length}
							focused={index === layout.focus}
							maximized={maximized}
							topRight={index === topRightPane && detailsView !== null}
							host={pane.kind === "live" ? all.hosts.find(h => h.instanceId === pane.instanceId) ?? null : null}
							lastHost={pane.kind === "live" ? state.lastHosts.get(pane.instanceId) ?? null : null}
							session={pane.kind === "past" ? all.past.find(s => s.sessionId === pane.sessionId) ?? null : null}
							initialDraft={state.draft && sameView(state.draft.view, pane) ? state.draft.text : ""}
							models={(pane.kind === "live" && state.models.get(pane.instanceId)) || UNREAD}
							onLayout={onPaneLayout}
							toggleRight={toggleRight}
							rightOpen={sidebars.panels.right.open}
						/>
					))}
					{split && !maximized && <SplitResizeHandle axis="columns" ratio={columns} onRatio={setColumns} span={layout.panes.length === 3 ? rows : 1} />}
					{layout.panes.length > 2 && !maximized && <SplitResizeHandle axis="rows" ratio={rows} onRatio={setRows} />}
				</div>
			);
		}
		if (all.hosts.length === 0) return <EmptyState rosterError={state.rosterError} />;
		return (
			<p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
				Select a session to see its conversation. {SPLIT_CLICK} more to see up to four side by side.
			</p>
		);
	};
	let main: ReactNode;
	switch (page?.kind) {
		case "new": {
			const cwd = page.cwd ?? defaultWorkspace;
			const seed = todoSeed(state.userTodos, page.todoId);
			main = (
				<NewSession
					// A todo's title and notes start the draft, so the draft mounts anew once the list names it.
					key={seed ? `todo:${page.todoId}` : "new"}
					cwd={cwd}
					workspaces={projects}
					launch={launch}
					connected={state.connected}
					completions={state.newSessionCompletions}
					onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
					onPickCwd={next => {
						// A failed start's error is about the directory left behind.
						dismissStart("new");
						location.hash = hashForNewSession(next, page.todoId);
					}}
					onStart={op => start({ kind: "new", cwd, ...op, todoId: seed && page.todoId })}
					todo={seed}
				/>
			);
			break;
		}
		case "settings":
			main = <SettingsPage cwd={page.cwd} workspaces={projects} tab={settingsTab} />;
			break;
		case "inbox":
			main = page.target ? (
				<PullRequestPage project={project} hosts={visible.hosts} target={page.target} />
			) : (
				<InboxPage project={project} hosts={visible.hosts} past={visible.past} section={sectionTarget} />
			);
			break;
		case "tickets":
			if (linear && !linearCallable) main = <TicketsDisconnected linear={linear} />;
			// Until the sessions are listed, the workspace a quick action starts in is not known yet.
			else if (state.listed) {
				main = (
					<TicketsPage target={page.target} section={sectionTarget} cwd={defaultWorkspace} hosts={visible.hosts} />
				);
			} else main = <p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>;
			break;
		case "todo": {
			const todoProps = {
				disabled: !state.connected,
				onChange: changeTodo,
				newSessionCwd: defaultWorkspace,
				linearConnected: linearCallable,
			};
			// A linked session resolves wherever it ran, even in a directory the sidebar does not list.
			main = <TodoPage list={state.userTodos} view={todoView} hosts={all.hosts} past={all.past} {...todoProps} />;
			break;
		}
		case "routines":
			main = (
				// Keyed by its target, so leaving for another routine or the list closes the editor.
				<RoutinesPage
					key={routinesTarget ?? ""}
					routines={state.routines}
					target={routinesTarget}
					// Every host, since a routine may run in `/tmp`, which the sidebar hides, and its runs still name their sessions.
					hosts={all.hosts}
					workspaces={projects}
					defaultCwd={defaultWorkspace}
					connected={state.connected}
				/>
			);
			break;
		case "calendar":
			main = <CalendarPage routines={state.routines} todos={state.userTodos} ticketsShown={linearCallable} />;
			break;
		case "changes":
			main = (
				<ChangesPage
					key={page.sessionId}
					sessionId={page.sessionId}
					path={page.path}
					host={all.hosts.find(host => host.sessionId === page.sessionId) ?? null}
					past={all.past.find(session => session.sessionId === page.sessionId) ?? null}
				/>
			);
			break;
		case undefined:
			main = panes();
			break;
		default: {
			const never: never = page;
			return never;
		}
	}

	return (
		<DashboardContext.Provider value={dashboard}>
			<CheckoutVersion.Provider value={switches}>
				<div className="flex h-svh flex-col">
					<SidebarProvider persist={false} shortcut={null} className="min-h-0 flex-1">
						<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
							<Roster
								projects={projects}
								lists={lists}
								waiting={waitingCount(projectLists)}
								query={sessionQuery}
								onQuery={setSessionQuery}
								onTogglePin={togglePin}
								open={page ? [] : layout.panes}
								newSessionOpen={page?.kind === "new"}
								ticketsShown={ticketsShown}
								tab={tab}
								onTab={showTab}
								userTodos={state.userTodos}
								todoView={todoView}
								todoSessions={{ hosts: state.hosts, past: state.past }}
								routines={state.routines}
								calendarTab={page?.kind === "calendar" ? page : page?.kind === "routines" ? { kind: "routines", target: routinesTarget } : null}
								settingsTab={settingsTab}
								onSettingsTab={setSettingsTab}
								sectionTarget={sectionTarget}
								onSectionTarget={setSectionTarget}
								inbox={
									// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
									!state.listed ? (
										<p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>
									) : onInboxPage ? (
										<InboxIndex project={project} hosts={visible.hosts} target={sectionTarget} onTarget={setSectionTarget} />
									) : (
										<InboxNav project={project} hosts={visible.hosts} past={visible.past} target={inboxTarget} />
									)
								}
								hosts={visible.hosts}
								project={project}
								onPickProject={switchProject}
								onShowSearch={() => dispatchPalette({ type: "open" })}
								onShowShortcuts={() => setShortcutsOpen(true)}
								toggle={<SidebarToggle side="left" open onToggle={() => toggleSidebar("left")} />}
							/>
						</DashboardSidebar>
						<SidebarInset>
							<Plans value={state.usage?.plans ?? NO_PLANS}>
								<ActivityVisibility.Provider value={activityVisibility}>
									<ToolsExpanded value={toolsExpanded}>{main}</ToolsExpanded>
								</ActivityVisibility.Provider>
							</Plans>
						</SidebarInset>
						{detailsView && (
							<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
								<SessionDetails
									key={hashForView(detailsView)}
									view={detailsView}
									working={detailsView.kind === "live" && subjectOf(detailsView, viewHost ?? null, viewLastHost).working}
									sessionId={detailsView.kind === "past" ? detailsView.sessionId : detailsView.agentId === null ? ((viewHost ?? viewLastHost)?.sessionId ?? null) : null}
								/>
							</DashboardSidebar>
						)}
						<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
						{filePath !== null && <FileDialog key={filePath} path={filePath} onClose={() => setFilePath(null)} />}
						<CommandPalette
							state={palette}
							dispatch={dispatchPalette}
							hosts={visible.hosts}
							past={visible.past}
							projects={projects}
							project={project}
							onOpenSession={(picked, cwd, mode) => {
								const next = projectSwitch(project, cwd);
								if (next !== null) pickProject(next);
								open(picked, mode);
							}}
							onPickProject={switchProject}
							pinned={pinned}
							onTogglePin={togglePin}
							handlers={handlers}
							unavailable={unavailable}
							onCreateTodo={
								state.connected && state.userTodos
									? text => {
											const change = quickAddTodo(text, state.userTodos?.categories ?? [], localDay());
											if (change) changeTodo(change);
										}
									: undefined
							}
						/>
					</SidebarProvider>
					<StatusBar usage={state.usage} checkout={checkout} onSwitched={() => setSwitches(count => count + 1)} />
				</div>
			</CheckoutVersion.Provider>
		</DashboardContext.Provider>
	);
}
