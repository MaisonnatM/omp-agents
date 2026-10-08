import { useCallback, useMemo, useRef, useState } from "react";
import { callable, signedIn } from "../src/shared/accounts";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { CommandPalette } from "./components/command-palette/command-palette";
import {
	type DashboardActions,
	DashboardActionsContext,
	type DashboardStatus,
	DashboardStatusContext,
	MentionListsContext,
} from "./components/dashboard-context";
import { FileDialog } from "./components/file-dialog";
import { PageSwitch } from "./components/page-switch";
import { NO_PLANS, Plans } from "./components/plan-usage";
import { useNoticeToasts } from "./components/notices";
import { SessionDetails } from "./components/session-details";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, useSidebarPanels } from "./components/sidebar-panel";
import { StatusBar } from "./components/status-bar";
import { subjectOf } from "./components/subject";
import { NewTicketDialog } from "./components/tickets/new-ticket";
import { ActivityVisibility, ToolsExpanded } from "./components/transcript";
import { localDay } from "./days";
import { integrationsStore } from "./reads";
import { endSession, hashForView, type TodoListView } from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, projectSession, projectSwitch } from "./sessions";
import { startOf } from "./starts";
import { quickAddTodo } from "./todo-quick-add";
import { useDashboard } from "./use-dashboard";
import { useFocusedSession } from "./use-focused-session";
import { useOverlays } from "./use-overlays";
import { usePageShortcuts } from "./use-page-shortcuts";
import { useSessionLists } from "./use-session-lists";
import { settingsRoute, useSidebarTab } from "./use-sidebar-tab";
import { useTranscriptDisplay } from "./use-transcript-display";
import { useWorkspace } from "./use-workspace";

const ALL_TODOS: TodoListView = { kind: "all" };

/**
 * The dashboard: the socket's state, sliced into what each part reads, and the parts. Each hook it calls owns one
 * slice, and the two dashboard contexts split what is stable, the actions, from what changes, the connection and the starts.
 */
export function App() {
	const { state, page, send, open, focus, show, navigate, openNewSession, dismissStart, start, changeTodo } = useDashboard();

	const { layout } = state;
	const sidebars = useSidebarPanels();
	const workspace = useWorkspace(state);
	const { visible, projects, project, pickProject, hiddenCwds } = workspace;
	const focused = useFocusedSession(state, page, workspace);
	const sessions = useSessionLists(workspace);
	const overlays = useOverlays();
	const display = useTranscriptDisplay();
	useNoticeToasts(state.notices, state.connected, send);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const linear = integrationsStore.usePolling().read?.data.integrations.linear ?? null;
	/** The Tickets tab and its shortcut show once omp holds a sign-in to Linear, even one Linear refuses, which the tickets page then offers to reconnect. */
	const ticketsShown = linear !== null && signedIn(linear.connection);
	/** The dashboard reads and writes Linear: the tickets page lists issues, the Todo page creates them, and the Calendar shows their due days. */
	const linearCallable = linear !== null && callable(linear.connection);
	const settings = useMemo(() => settingsRoute(page, focused.cwd), [page, focused.cwd]);
	const { tab, showTab } = useSidebarTab({ page, ticketsShown, layout, settings, navigate, show });
	const maximized = layout.maximized && !page;
	/** The view whose details the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const detailsView = page || (layout.panes.length > 1 && !maximized) ? null : focused.view;
	const defaultWorkspace = defaultCwd(focused.view, visible.hosts, visible.past, project);
	// The live rows of the sessions list, whose order ending a session moves its panes along.
	const listedHosts = sessions.listed.flatMap(view => (view.kind === "live" ? view.instanceId : []));
	const latest = useRef({ layout, listedHosts, sidebars, page, hosts: visible.hosts, cwd: focused.cwd });
	latest.current = { layout, listedHosts, sidebars, page, hosts: visible.hosts, cwd: focused.cwd };

	const endHost = useCallback(
		(instanceId: string): void => {
			send({ t: "end", instanceId });
			show(endSession(latest.current.layout, instanceId, latest.current.listedHosts));
		},
		[send, show],
	);
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const switchProject = useCallback(
		(cwd: string | null): void => {
			pickProject(cwd);
			// A page such as the tickets stays; only the panes follow the sidebar into the project.
			const { page, hosts, cwd: viewCwd } = latest.current;
			const next = page ? null : projectSession(cwd, hosts, viewCwd);
			if (next) open(next, "replace");
		},
		[pickProject, open],
	);

	const { setShortcutsOpen, setFilePath, setNewTicket, dispatchPalette } = overlays;
	const { handlers, unavailable } = usePageShortcuts({
		page,
		layout,
		maximized,
		tab,
		settings,
		listed: sessions.listed,
		view: focused.view,
		ticketsShown,
		linearCallable,
		hasDetails: detailsView !== null,
		palette: overlays.palette,
		dispatchPalette,
		setShortcutsOpen,
		setNewTicket,
		openNewSession,
		open,
		show,
		navigate,
		showTab,
		toggleSidebar,
		toggleTools: display.toggleTools,
		toggleHideTools: display.toggleHideTools,
		toggleHideThinking: display.toggleHideThinking,
	});

	const actions = useMemo(
		(): DashboardActions => ({ send, open, focus, start, dismissStart, openNewSession, changeTodo, end: endHost, openFile: setFilePath, openNewTicket: setNewTicket }),
		[send, open, focus, start, dismissStart, openNewSession, changeTodo, endHost, setFilePath, setNewTicket],
	);
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const resumeAll = startOf(state.starts, "resume-all");
	// The project that `useWorkspace` polls the inbox of, so the `@` menu reads the entry the page keeps current.
	const status = useMemo((): DashboardStatus => ({ connected: state.connected, starts: { fork, resume, quick, resumeAll }, inboxScope: project }), [state.connected, fork, resume, quick, resumeAll, project]);
	const mentionLists = useMemo(() => ({ todos: state.userTodos?.todos ?? [], hosts: visible.hosts, past: visible.past }), [state.userTodos, visible]);

	const routedTodoList = page?.kind === "todo" ? page.list : null;
	const categories = state.userTodos?.categories;
	/** The list the Todo page shows; a category another window removed shows every todo. */
	const todoView = useMemo(
		(): TodoListView => (routedTodoList === null || (routedTodoList.kind === "category" && !categories?.some(({ id }) => id === routedTodoList.id)) ? ALL_TODOS : routedTodoList),
		[routedTodoList, categories],
	);
	/** The routine the Routines page shows; one another window deleted shows the list. */
	const routinesTarget = page?.kind === "routines" && state.routines.some(({ id }) => id === page.target) ? page.target : null;

	return (
		<DashboardActionsContext.Provider value={actions}>
			<DashboardStatusContext.Provider value={status}>
				<div className="flex h-svh flex-col">
					<SidebarProvider persist={false} shortcut={null} className="min-h-0 flex-1">
						<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
							<AppSidebar
								workspace={workspace}
								sessions={sessions}
								page={page}
								panes={layout.panes}
								tab={tab}
								onTab={showTab}
								ticketsShown={ticketsShown}
								listed={state.listed}
								userTodos={state.userTodos}
								hosts={state.hosts}
								notices={state.notices}
								past={state.past}
								routines={state.routines}
								todoView={todoView}
								routinesTarget={routinesTarget}
								settings={settings}
								sectionTarget={sectionTarget}
								onSectionTarget={setSectionTarget}
								onPickProject={switchProject}
								dispatchPalette={dispatchPalette}
								setShortcutsOpen={setShortcutsOpen}
								toggleSidebar={toggleSidebar}
							/>
						</DashboardSidebar>
						<SidebarInset>
							<Plans value={state.usage?.plans ?? NO_PLANS}>
								<ActivityVisibility.Provider value={display.activityVisibility}>
									<ToolsExpanded value={display.toolsExpanded}>
										<MentionListsContext.Provider value={mentionLists}>
											<PageSwitch
												page={page}
												state={state}
												workspace={workspace}
												defaultWorkspace={defaultWorkspace}
												sectionTarget={sectionTarget}
												todoView={todoView}
												routinesTarget={routinesTarget}
												linear={linear}
												linearCallable={linearCallable}
												maximized={maximized}
												hasDetails={detailsView !== null}
												rightOpen={sidebars.panels.right.open}
												show={show}
												toggleSidebar={toggleSidebar}
											/>
										</MentionListsContext.Provider>
									</ToolsExpanded>
								</ActivityVisibility.Provider>
							</Plans>
						</SidebarInset>
						{detailsView && (
							<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
								<SessionDetails
									key={hashForView(detailsView)}
									view={detailsView}
									working={detailsView.kind === "live" && subjectOf(detailsView, focused.host ?? null, focused.lastHost).working}
									sessionId={detailsView.kind === "past" ? detailsView.sessionId : detailsView.agentId === null ? ((focused.host ?? focused.lastHost)?.sessionId ?? null) : null}
									pullRequests={focused.row?.pullRequests ?? []}
									project={project}
									hosts={visible.hosts}
								/>
							</DashboardSidebar>
						)}
						<ShortcutsDialog open={overlays.shortcutsOpen} onOpenChange={setShortcutsOpen} />
						{overlays.filePath !== null && <FileDialog key={overlays.filePath} path={overlays.filePath} onClose={() => setFilePath(null)} />}
						{overlays.newTicket !== null && <NewTicketDialog title={overlays.newTicket} onClose={() => setNewTicket(null)} />}
						<CommandPalette
							state={overlays.palette}
							dispatch={dispatchPalette}
							hosts={visible.hosts}
							past={visible.past}
							projects={projects}
							project={project}
							onOpenSession={(picked, cwd, mode) => {
								const next = projectSwitch(project, cwd, hiddenCwds);
								if (next !== null) pickProject(next);
								open(picked, mode);
							}}
							onPickProject={switchProject}
							pinned={sessions.pinned}
							onTogglePin={sessions.togglePin}
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
							onCreateTicket={linearCallable ? setNewTicket : undefined}
						/>
					</SidebarProvider>
					<StatusBar usage={state.usage} workspace={focused.workspace} />
				</div>
			</DashboardStatusContext.Provider>
		</DashboardActionsContext.Provider>
	);
}
