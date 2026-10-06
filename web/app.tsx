import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUICK_TODO_EVENT, type UserTodoList } from "../src/shared";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { AnalyticsPage } from "./components/analytics/analytics-page";
import { DashboardContext } from "./components/dashboard-context";
import { FileDialog } from "./components/file-dialog";
import { InboxNav } from "./components/inbox/inbox-nav";
import { PullRequestPage } from "./components/inbox/pr-page";
import { NewSession } from "./components/new-session";
import { Pane } from "./components/pane";
import { PlanPanel } from "./components/plan-panel";
import { NO_PLANS, PlanUsageFooter, Plans } from "./components/plan-usage";
import { Roster, type SidebarTab, useProject } from "./components/roster";
import { SettingsPage } from "./components/settings/settings-page";
import { SessionSwitcher } from "./components/session-switcher";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, SidebarToggle, useSidebarPanels } from "./components/sidebar-panel";
import { SplitResizeHandle, splitAt, useSplitRatio } from "./components/split-resize-handle";
import { RoutinesPage } from "./components/routines/routines-page";
import { TicketsDisconnected, TicketsPage } from "./components/tickets/tickets-page";
import { ToolsExpanded } from "./components/transcript";
import { ArchivePage } from "./components/todo-archive";
import { TodoPage } from "./components/user-todos";
import { documentTitle } from "./document-title";
import { SPLIT_CLICK } from "./labels";
import { inboxStore, linearStore, UNREAD } from "./reads";
import {
	adjacentSession,
	closePane,
	endSession,
	focusedView,
	hashForNewSession,
	hashForPage,
	hashForView,
	type Page,
	sameView,
	type TodoListView,
} from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, discoverableSessions, listedViews, projectSession, projectSwitch, searchSessions, sidebarSessions, waitingCount, workspaces } from "./sessions";
import { useShortcuts } from "./shortcuts";
import { startOf } from "./starts";
import { PINNED_SESSIONS_KEY, useStoredKeys } from "./stored-state";
import { useDashboard } from "./use-dashboard";

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
	const visible = discoverableSessions(state.hosts, state.past);
	const projects = workspaces(visible.hosts, visible.past);
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
	/** The pull request whose details the main area shows; `#inbox` alone keeps the panes, with the inbox in the sidebar. */
	const inboxTarget = page?.kind === "inbox" ? page.target : null;
	const cover = page?.kind === "inbox" && !inboxTarget ? null : page;
	const view = focusedView(layout);
	const viewHost = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;
	const title = documentTitle(cover, view, viewHost ?? (view?.kind === "live" ? state.lastHosts.get(view.instanceId) ?? null : null), viewPast ?? null);
	useEffect(() => {
		document.title = title;
	}, [title]);
	const viewCwd = (viewHost ?? viewPast)?.cwd;
	const split = layout.panes.length > 1;
	const [columns, setColumns] = useSplitRatio("columns");
	const [rows, setRows] = useSplitRatio("rows");
	const maximized = layout.maximized && !cover;
	const [sessionQuery, setSessionQuery] = useState("");
	const projectLists = sidebarSessions(visible.hosts, visible.past, project, pinned);
	const lists = searchSessions(projectLists, sessionQuery);
	const listed = listedViews(lists);
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
	const planView = cover || (split && !maximized) ? null : view;
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const toggleRight = useCallback(() => toggleSidebar("right"), [toggleSidebar]);
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);

	const switchProject = (cwd: string | null): void => {
		pickProject(cwd);
		// A page such as the tickets stays; only the panes follow the sidebar into the project.
		const next = cover ? null : projectSession(cwd, visible.hosts, viewCwd);
		if (next) open(next, "replace");
	};
	const settingsPage: Page = { kind: "settings", cwd: page?.kind === "settings" ? page.cwd : viewCwd || null };
	const settingsHref = hashForPage(settingsPage);
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [switcherOpen, setSwitcherOpen] = useState(false);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const linear = linearStore.usePolling();
	/** The Tickets tab and its shortcut show only once omp is signed in to Linear. */
	const ticketsShown = linear.read?.data.connected === true;
	/** The tab the sidebar shows over the panes: `#inbox` picks the inbox, and it stays while you work in the panes until you choose Sessions. */
	const onInbox = page?.kind === "inbox";
	const [paneTab, setPaneTab] = useState<"sessions" | "inbox">(onInbox ? "inbox" : "sessions");
	const [wasOnInbox, setWasOnInbox] = useState(onInbox);
	if (onInbox !== wasOnInbox) {
		setWasOnInbox(onInbox);
		if (onInbox) setPaneTab("inbox");
	}
	const tab: SidebarTab =
		page?.kind === "todo" || page?.kind === "routines" ? page.kind : page?.kind === "tickets" && ticketsShown ? "tickets" : page?.kind === "inbox" ? "inbox" : paneTab;
	const routedTodoList = page?.kind === "todo" ? page.list : null;
	/** The list the Todo page shows; a category another window removed shows every todo. */
	const todoView: TodoListView =
		routedTodoList === null || (routedTodoList.kind === "category" && !state.userTodos?.categories.some(({ id }) => id === routedTodoList.id))
			? { kind: "all" }
			: routedTodoList;
	/** The desktop shell's quick-capture shortcut asked for a new todo, which the Todo page has not started yet. */
	const [quickTodo, setQuickTodo] = useState(false);
	const startQuickTodo = useCallback((): void => {
		navigate({ kind: "todo", list: { kind: "all" } });
		setQuickTodo(true);
	}, [navigate]);
	useEffect(() => {
		window.addEventListener(QUICK_TODO_EVENT, startQuickTodo);
		return () => window.removeEventListener(QUICK_TODO_EVENT, startQuickTodo);
	}, [startQuickTodo]);
	/** The routine the Routines page shows; one another window deleted shows the list. */
	const routinesTarget = page?.kind === "routines" && state.routines.some(({ id }) => id === page.target) ? page.target : null;
	const showTab = (next: SidebarTab): void => {
		if (next === "sessions") {
			setPaneTab("sessions");
			show(layout);
		} else if (next === "todo") navigate({ kind: "todo", list: { kind: "all" } });
		else navigate({ kind: next, target: null });
	};
	const step = (by: 1 | -1): boolean | void => {
		const next = adjacentSession(listed, view, by);
		if (next) open(next, "replace");
		else if (!listed.length) return false;
	};
	useShortcuts({
		help: () => setShortcutsOpen(open => !open),
		switcher: () => setSwitcherOpen(open => !open),
		newSession: openNewSession,
		previousSession: () => step(-1),
		nextSession: () => step(1),
		tools: () => setToolsExpanded(expanded => !expanded),
		sessionsSidebar: () => toggleSidebar("left"),
		planSidebar: () => {
			if (!planView) return false;
			toggleSidebar("right");
		},
		settings: () => {
			if (page?.kind === "settings") show(layout);
			else navigate(settingsPage);
		},
		inbox: () => {
			if (tab === "inbox" && !cover) return false;
			showTab("inbox");
		},
		tickets: () => {
			if (page?.kind === "tickets" || !ticketsShown) return false;
			showTab("tickets");
		},
		sessions: () => {
			if (tab === "sessions" && !cover) return false;
			showTab("sessions");
		},
		todo: () => {
			if (page?.kind === "todo") return false;
			showTab("todo");
		},
		routines: () => {
			if (page?.kind === "routines") return false;
			showTab("routines");
		},
		restore: () => {
			if (!maximized) return false;
			show({ ...layout, maximized: false });
		},
	});

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
							topRight={index === topRightPane && planView !== null}
							host={pane.kind === "live" ? state.hosts.find(h => h.instanceId === pane.instanceId) ?? null : null}
							lastHost={pane.kind === "live" ? state.lastHosts.get(pane.instanceId) ?? null : null}
							session={pane.kind === "past" ? state.past.find(s => s.sessionId === pane.sessionId) ?? null : null}
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
		if (state.hosts.length === 0) return <EmptyState rosterError={state.rosterError} />;
		return (
			<p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
				Select a session to see its conversation. {SPLIT_CLICK} more to see up to four side by side.
			</p>
		);
	};
	let main: ReactNode;
	switch (page?.kind) {
		case "new": {
			const cwd = page.cwd ?? defaultCwd(view, visible.hosts, visible.past, project);
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
			main = <SettingsPage cwd={page.cwd} workspaces={projects} />;
			break;
		case "analytics":
			main = <AnalyticsPage range={page.range} />;
			break;
		case "inbox":
			main = page.target ? <PullRequestPage project={project} hosts={visible.hosts} target={page.target} /> : panes();
			break;
		case "tickets":
			if (linear.read && !ticketsShown) main = <TicketsDisconnected />;
			// Until the sessions are listed, the workspace a quick action starts in is not known yet.
			else if (state.listed) {
				main = (
					<TicketsPage target={page.target} section={sectionTarget} cwd={defaultCwd(view, visible.hosts, visible.past, project)} hosts={visible.hosts} />
				);
			} else main = <p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>;
			break;
		case "todo": {
			const todoProps = {
				disabled: !state.connected,
				onChange: changeTodo,
				newSessionCwd: defaultCwd(view, visible.hosts, visible.past, project),
				linearConnected: ticketsShown,
			};
			// A linked session resolves wherever it ran, even in a directory the sidebar does not list.
			const sessions = { hosts: state.hosts, past: state.past };
			main =
				todoView.kind === "done" && state.userTodos ? (
					<ArchivePage list={state.userTodos} sessions={sessions} {...todoProps} />
				) : (
					<TodoPage list={state.userTodos} view={todoView} {...sessions} {...todoProps} quickTodo={quickTodo} onQuickTodo={() => setQuickTodo(false)} />
				);
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
					hosts={state.hosts}
					workspaces={projects}
					defaultCwd={defaultCwd(view, visible.hosts, visible.past, project)}
					connected={state.connected}
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
			<SidebarProvider persist={false} shortcut={null} className="h-svh">
				<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
					<Roster
						projects={projects}
						lists={lists}
						waiting={waitingCount(projectLists)}
						query={sessionQuery}
						onQuery={setSessionQuery}
						onTogglePin={togglePin}
						open={cover ? [] : layout.panes}
						newSessionOpen={page?.kind === "new"}
						settingsHref={settingsHref}
						settingsOpen={page?.kind === "settings"}
						ticketsShown={ticketsShown}
						tab={tab}
						onTab={showTab}
						userTodos={state.userTodos}
						todoView={todoView}
						routines={state.routines}
						routinesTarget={routinesTarget}
						sectionTarget={sectionTarget}
						onSectionTarget={setSectionTarget}
						inbox={
							// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
							state.listed ? (
								<InboxNav project={project} hosts={visible.hosts} past={visible.past} target={inboxTarget} />
							) : (
								<p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>
							)
						}
						hosts={visible.hosts}
						project={project}
						onPickProject={switchProject}
						onShowSearch={() => setSwitcherOpen(true)}
						onShowShortcuts={() => setShortcutsOpen(true)}
						toggle={<SidebarToggle side="left" open onToggle={() => toggleSidebar("left")} />}
					/>
					<PlanUsageFooter usage={state.usage} analyticsOpen={page?.kind === "analytics"} />
				</DashboardSidebar>
				<SidebarInset>
					<Plans value={state.usage?.plans ?? NO_PLANS}>
						<ToolsExpanded value={toolsExpanded}>{main}</ToolsExpanded>
					</Plans>
				</SidebarInset>
				{planView && (
					<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
						<PlanPanel key={hashForView(planView)} view={planView} host={viewHost ?? null} />
					</DashboardSidebar>
				)}
				<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
				{filePath !== null && <FileDialog key={filePath} path={filePath} onClose={() => setFilePath(null)} />}
				<SessionSwitcher
					open={switcherOpen}
					onOpenChange={setSwitcherOpen}
					hosts={visible.hosts}
					past={visible.past}
					onPick={(picked, cwd) => {
						const next = projectSwitch(project, cwd);
						if (next !== null) pickProject(next);
						open(picked, "replace");
					}}
					onCreateTodo={
						state.connected && state.userTodos
							? text => changeTodo({ op: "add", id: crypto.randomUUID(), parentId: null, afterId: null, categoryId: null, text })
							: undefined
					}
				/>
			</SidebarProvider>
		</DashboardContext.Provider>
	);
}
