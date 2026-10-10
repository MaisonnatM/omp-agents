import { useCallback, useMemo, useRef, useState } from "react";
import { callable, signedIn } from "../src/shared/accounts";
import type { View } from "../src/shared/sessions";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { errorText } from "./api";
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
import { RenderBoundary } from "./components/render-boundary";
import { SessionDetails } from "./components/session-details";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, useSidebarPanels } from "./components/sidebar-panel";
import { StatusBar } from "./components/status-bar";
import { subjectOf } from "./components/subject";
import { NewTicketDialog } from "./components/tickets/new-ticket";
import { TerminalPanel, useTerminalPanel } from "./components/terminal/terminal-panel";
import { ActivityVisibility, ToolsExpanded } from "./components/transcript";
import { toasts } from "./components/toaster";
import { integrationsStore } from "./reads";
import { endSession, hashForLayout, hashForPage, hashForView, type OpenMode, type TodoListView } from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, projectSession, projectSwitch } from "./sessions";
import { startOf } from "./starts";
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
	const { state, page, send, request, end, open, focus, show, navigate, openNewSession, dismissStart, start, changeTodo, changePins } = useDashboard();

	const { layout } = state;
	const sidebars = useSidebarPanels();
	const workspace = useWorkspace(state);
	const { visible, projects, project, pickProject, hiddenCwds } = workspace;
	const focused = useFocusedSession(state, page, workspace);
	const sessions = useSessionLists(workspace, state.pins, changePins);
	const overlays = useOverlays();
	const display = useTranscriptDisplay();
	const terminal = useTerminalPanel();
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
	const latest = useRef({ layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, liveHosts: state.hosts, cwd: focused.cwd });
	latest.current = { layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, liveHosts: state.hosts, cwd: focused.cwd };

	const endHost = useCallback(
		(instanceId: string): void => {
			if (latest.current.ending.has(instanceId)) return;
			const listedBeforeEnd = latest.current.listedHosts;
			end(instanceId).then(
				() => {
					const { layout, liveHosts, ending } = latest.current;
					const eligible = new Set(liveHosts.filter(host => !ending.has(host.instanceId)).map(host => host.instanceId));
					show(endSession(layout, instanceId, listedBeforeEnd, eligible));
				},
				(error: unknown) => toasts.add({ title: "Could not end the session", description: errorText(error) }),
			);
		},
		[end, show],
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
	/** The palette opens a session from any project, so the sidebar switches to that project to keep it listed. */
	const openFromPalette = useCallback(
		(picked: View, cwd: string, mode: OpenMode): void => {
			const next = projectSwitch(project, cwd, hiddenCwds);
			if (next !== null) pickProject(next);
			open(picked, mode);
		},
		[project, hiddenCwds, pickProject, open],
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
		toggleTerminal: terminal.toggle,
	});

	const actions = useMemo(
		(): DashboardActions => ({ send, request, open, focus, start, dismissStart, openNewSession, changeTodo, end: endHost, openFile: setFilePath, openNewTicket: setNewTicket }),
		[send, request, open, focus, start, dismissStart, openNewSession, changeTodo, endHost, setFilePath, setNewTicket],
	);
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const resumeAll = startOf(state.starts, "resume-all");
	// The project that `useWorkspace` polls the inbox of, so the `@` menu reads the entry the page keeps current.
	const status = useMemo(
		(): DashboardStatus => ({ connected: state.connected, starts: { fork, resume, quick, resumeAll }, ending: state.ending, pullRequestScope: project }),
		[state.connected, fork, resume, quick, resumeAll, state.ending, project],
	);
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
					<SidebarProvider className="min-h-0 flex-1">
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
											<RenderBoundary resetKey={page ? hashForPage(page) : hashForLayout(layout)}>
												<PageSwitch
													page={page}
													hosts={state.hosts}
													past={state.past}
													lastHosts={state.lastHosts}
													layout={layout}
													draft={state.draft}
													models={state.models}
													userTodos={state.userTodos}
													routines={state.routines}
													projectList={state.projectList}
													pins={state.pins}
													newSessionCompletions={state.newSessionCompletions}
													connected={state.connected}
													listed={state.listed}
													rosterError={state.rosterError}
													newStart={startOf(state.starts, "new")}
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
											</RenderBoundary>
										</MentionListsContext.Provider>
									</ToolsExpanded>
								</ActivityVisibility.Provider>
							</Plans>
							<TerminalPanel panel={terminal} cwd={focused.workspace ?? project ?? "~"} />
						</SidebarInset>
						{detailsView && (
							<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
								<SessionDetails
									key={hashForView(detailsView)}
									view={detailsView}
									working={detailsView.kind === "live" && subjectOf(detailsView, focused.host ?? null, focused.lastHost).working}
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
							onOpenSession={openFromPalette}
							onPickProject={switchProject}
							pinned={sessions.pinned}
							onTogglePin={sessions.togglePin}
							handlers={handlers}
							unavailable={unavailable}
							todoCategories={state.connected && state.userTodos ? state.userTodos.categories : null}
							onCreateTicket={linearCallable ? setNewTicket : undefined}
						/>
					</SidebarProvider>
					<StatusBar usage={state.usage} terminalOpen={terminal.open} onToggleTerminal={terminal.toggle} />
				</div>
			</DashboardStatusContext.Provider>
		</DashboardActionsContext.Provider>
	);
}
