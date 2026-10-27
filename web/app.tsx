import { useCallback, useMemo, useRef, useState } from "react";
import { callable } from "../src/shared/accounts";
import type { View } from "../src/shared/sessions";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { errorText } from "../src/json";
import { AppSidebar } from "./components/app-sidebar";
import { BotDetails } from "./components/bots/bot-details";
import { CommandPalette } from "./components/command-palette/command-palette";
import { DESKTOP_TITLE_BAR, DesktopTitleBar, HeaderControls, HeaderControlsContext } from "./components/header-controls";
import {
	type DashboardActions,
	DashboardActionsContext,
	type DashboardStatus,
	DashboardStatusContext,
	MentionListsContext,
	UserNotesContext,
	UserTodosContext,
} from "./components/dashboard-context";
import { DesktopLinkPreview } from "./components/desktop-link-preview";
import { DiscussionPanel } from "./components/discussion-panel";
import { FileDialog } from "./components/file-dialog";
import { PageSwitch } from "./components/page-switch";
import { NO_PLANS, Plans } from "./components/plan-usage";
import { useNoticeToasts } from "./components/use-notice-toasts";
import { RenderBoundary } from "./components/render-boundary";
import { ScheduledSends } from "./components/scheduled";
import { SessionDetails } from "./components/session-details";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, useSidebarPanels } from "./components/sidebar-panel";
import { StatusBar } from "./components/status-bar";
import { subjectOf } from "./components/subject";
import { NewTicketDialog } from "./components/tickets/new-ticket";
import { TerminalPanel, useTerminalPanel } from "./components/terminal/terminal-panel";
import { ActivityVisibility, ToolsExpanded } from "./components/transcript";
import { toasts } from "./components/toaster";
import { routeOf } from "./dashboard-state";
import { useOpenPullRequest } from "./open-pull-request";
import { integrationsStore } from "./reads";
import { hashForRoute, hashForView, type NotesListView, type OpenMode, TAB_GROUPS, type TabGroup, type TodoListView } from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, workspaceSession, workspaceSwitch } from "./sessions";
import { groupTabs, useSidebarTabs } from "./sidebar-tabs";
import { startOf } from "./starts";
import { useAttention } from "./use-attention";
import { useDashboard } from "./use-dashboard";
import { useFocusedSession } from "./use-focused-session";
import { useOverlays } from "./use-overlays";
import { usePageShortcuts } from "./use-page-shortcuts";
import { useSessionLists } from "./use-session-lists";
import { settingsRoute, useSidebarTab } from "./use-sidebar-tab";
import { useTranscriptDisplay } from "./use-transcript-display";
import { useWorkspaceScope } from "./use-workspace-scope";

const ALL_TODOS: TodoListView = { kind: "all" };
const ALL_NOTES: NotesListView = { kind: "all" };

/**
 * The dashboard: the socket's state, sliced into what each part reads, and the parts. Each hook it calls owns one
 * slice, and the two dashboard contexts split what is stable, the actions, from what changes, the connection and the starts.
 */
export function App() {
	const { state, page, send, request, end, open, focus, show, close, resize, navigate, openNewSession, dismissStart, start, changeTodo, changeNote, changePins, changeBot } = useDashboard();

	const { layout } = state;
	const sidebars = useSidebarPanels();
	const scope = useWorkspaceScope(state);
	const { visible, workspaces, workspace, pickWorkspace, hiddenCwds } = scope;
	const focused = useFocusedSession(state, page, scope);
	const sessions = useSessionLists(scope, state.pins, changePins);
	const overlays = useOverlays();
	const display = useTranscriptDisplay();
	const terminal = useTerminalPanel();
	useNoticeToasts(state.notices, state.connected, send, start);
	useAttention(state, page, send);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const integrations = integrationsStore.usePolling().read?.data.integrations;
	const linear = integrations?.linear ?? null;
	const { signedOut: signedOutTabs, shown: tabs } = useSidebarTabs();
	/** The dashboard reads and writes Linear: the tickets page lists issues, the Todo page creates them, and the Calendar shows their due days. */
	const linearCallable = linear !== null && callable(linear.connection);
	const settings = useMemo(() => settingsRoute(page), [page]);
	const { tab, showTab, group, showGroup } = useSidebarTab({ page, signedOutTabs, shown: tabs, layout, latestSession: sessions.latest, navigate, show });
	const emptyGroups = useMemo((): ReadonlySet<TabGroup> => new Set(TAB_GROUPS.flatMap(({ value }) => (groupTabs(tabs, value).length === 0 ? [value] : []))), [tabs]);
	/** The tabs the bar draws, which Cmd+1 onward go to in order. */
	const barTabs = useMemo(() => groupTabs(tabs, group), [tabs, group]);
	const maximized = layout.maximized && !page;
	/** The view whose details the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const detailsView = page || (layout.panes.length > 1 && !maximized) ? null : focused.view;
	/** The Bot page that shows, if any, and its Bot, whose details the right sidebar shows in a session's place. */
	const botPage = page?.kind === "bots" && page.target !== null ? page : null;
	const detailsBot = botPage && (state.bots?.find(({ id }) => id === botPage.target) ?? null);
	const defaultWorkspace = defaultCwd(focused.view, visible.hosts, visible.past, workspace);
	// The live rows of the sessions list, whose order ending a session moves its panes along.
	const listedHosts = sessions.listed.flatMap(view => (view.kind === "live" ? view.instanceId : []));
	const latest = useRef({ layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, cwd: focused.cwd });
	latest.current = { layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, cwd: focused.cwd };

	const endHost = useCallback(
		(instanceId: string): void => {
			if (latest.current.ending.has(instanceId)) return;
			end(instanceId, latest.current.listedHosts).catch((error: unknown) => toasts.add({ title: "Could not end the session", description: errorText(error) }));
		},
		[end],
	);
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const switchWorkspace = useCallback(
		(cwd: string | null): void => {
			pickWorkspace(cwd);
			// A page such as the tickets stays; only the panes follow the sidebar into the workspace.
			const { page, hosts, cwd: viewCwd } = latest.current;
			const next = page ? null : workspaceSession(cwd, hosts, viewCwd);
			if (next) open(next, "replace");
		},
		[pickWorkspace, open],
	);
	/** The palette opens a session from any workspace, so the sidebar switches to that workspace to keep it listed. */
	const openFromPalette = useCallback(
		(picked: View, cwd: string, mode: OpenMode): void => {
			const next = workspaceSwitch(workspace, cwd, hiddenCwds);
			if (next !== null) pickWorkspace(next);
			open(picked, mode);
		},
		[workspace, hiddenCwds, pickWorkspace, open],
	);
	const workspaceSettings = useCallback(
		(cwd: string): (() => void) | null => {
			if (!workspaces.some(listed => listed.cwd === cwd)) return null;
			return () => {
				pickWorkspace(cwd);
				navigate({ kind: "settings", section: "models" });
			};
		},
		[workspaces, pickWorkspace, navigate],
	);

	const { setShortcutsOpen, setFilePath, setNewTicket, dispatchPalette } = overlays;
	// The command menu's **Open pull request** acts on the focused pane's session while the panes show, as its header's **Open PR** does.
	const openPullRequest = useOpenPullRequest(page ? null : focused.view, focused.host, request);
	const { handlers, unavailable } = usePageShortcuts({
		page,
		layout,
		maximized,
		tab,
		settings,
		listed: sessions.listed,
		view: focused.view,
		signedOutTabs,
		tabs: barTabs,
		linearCallable,
		hasDetails: detailsView !== null || detailsBot !== null,
		openPullRequest: openPullRequest.state.kind === "ready" ? openPullRequest.run : null,
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
		(): DashboardActions => ({ send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeNote, changeBot, end: endHost, openFile: setFilePath, openNewTicket: setNewTicket, workspaceSettings }),
		[send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeNote, changeBot, endHost, setFilePath, setNewTicket, workspaceSettings],
	);
	const fork = startOf(state.starts, "fork");
	const replay = startOf(state.starts, "replay");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const resumeAll = startOf(state.starts, "resume-all");
	// The workspace whose pull requests `useWorkspaceScope` polls, so the `@` menu reads the entry the page keeps current.
	const status = useMemo(
		(): DashboardStatus => ({ connected: state.connected, starts: { fork, replay, resume, quick, resumeAll }, ending: state.ending, pullRequestsScope: workspace, merges: state.merges, reviewDrafts: state.reviewDrafts }),
		[state.connected, fork, replay, resume, quick, resumeAll, state.ending, workspace, state.merges, state.reviewDrafts],
	);
	const mentionLists = useMemo(() => ({ todos: state.userTodos?.todos ?? [], hosts: visible.hosts, past: visible.past }), [state.userTodos, visible]);

	const routedTodoList = page?.kind === "todo" ? page.list : null;
	const categories = state.userTodos?.categories;
	/** The list the Todo page shows; a category another window removed shows every todo. */
	const todoView = useMemo(
		(): TodoListView => (routedTodoList === null || (routedTodoList.kind === "category" && !categories?.some(({ id }) => id === routedTodoList.id)) ? ALL_TODOS : routedTodoList),
		[routedTodoList, categories],
	);
	const notesView = page?.kind === "notes" ? page.list : ALL_NOTES;
	const showSearch = useCallback(() => dispatchPalette({ type: "open" }), [dispatchPalette]);
	const toggleSettings = useCallback(() => void handlers.settings?.(0), [handlers]);
	const headerControls = useMemo(
		() => (
			<HeaderControls
				notices={state.notices}
				onShowSearch={showSearch}
				group={group}
				emptyGroups={emptyGroups}
				onGroup={showGroup}
				settingsOpen={page?.kind === "settings"}
				onToggleSettings={toggleSettings}
			/>
		),
		[state.notices, showSearch, group, emptyGroups, showGroup, page?.kind, toggleSettings],
	);

	return (
		<DashboardActionsContext.Provider value={actions}>
			<DashboardStatusContext.Provider value={status}>
				<ScheduledSends.Provider value={state.scheduled}>
					<UserTodosContext.Provider value={state.userTodos}>
						<UserNotesContext.Provider value={state.userNotes}>
							<div className="flex h-svh flex-col">
								{DESKTOP_TITLE_BAR && <DesktopTitleBar title={focused.title} controls={headerControls} />}
								<SidebarProvider className="min-h-0 flex-1">
									<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
										<AppSidebar
											scope={scope}
											sessions={sessions}
											page={page}
											panes={layout.panes}
											tab={tab}
											onTab={showTab}
											tabs={barTabs}
											listed={state.listed}
											userTodos={state.userTodos}
											userNotes={state.userNotes}
											notesView={notesView}
											hosts={state.hosts}
											past={state.past}
											bots={state.bots}
											botLasts={state.botLasts}
											todoView={todoView}
											settings={settings}
											sectionTarget={sectionTarget}
											onSectionTarget={setSectionTarget}
											onPickWorkspace={switchWorkspace}
											setShortcutsOpen={setShortcutsOpen}
										/>
									</DashboardSidebar>
									<SidebarInset>
										<HeaderControlsContext.Provider value={DESKTOP_TITLE_BAR ? null : headerControls}>
											<Plans value={state.usage?.plans ?? NO_PLANS}>
												<ActivityVisibility.Provider value={display.activityVisibility}>
													<ToolsExpanded value={display.toolsExpanded}>
														<MentionListsContext.Provider value={mentionLists}>
															<RenderBoundary resetKey={hashForRoute(routeOf(state))}>
																<PageSwitch
																	page={page}
																	hosts={state.hosts}
																	past={state.past}
																	lastHosts={state.lastHosts}
																	layout={layout}
																	splits={state.splits}
																	models={state.models}
																	userTodos={state.userTodos}
																	userNotes={state.userNotes}
																	routines={state.routines}
																	bots={state.bots}
																	workspaceList={state.workspaceList}
																	pins={state.pins}
																	newSessionCompletions={state.newSessionCompletions}
																	connected={state.connected}
																	listed={state.listed}
																	rosterError={state.rosterError}
																	newStart={startOf(state.starts, "new")}
																	scope={scope}
																	defaultWorkspace={defaultWorkspace}
																	sectionTarget={sectionTarget}
																	todoView={todoView}
																	linear={linear}
																	linearCallable={linearCallable}
																	maximized={maximized}
																	hasDetails={detailsView !== null}
																	rightOpen={sidebars.panels.right.open}
																	show={show}
																	close={close}
																	resize={resize}
																	toggleSidebar={toggleSidebar}
																/>
															</RenderBoundary>
														</MentionListsContext.Provider>
													</ToolsExpanded>
												</ActivityVisibility.Provider>
											</Plans>
										</HeaderControlsContext.Provider>
										<TerminalPanel panel={terminal} cwd={focused.workDir ?? workspace ?? "~"} />
									</SidebarInset>
									{detailsView && (
										<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
											<SessionDetails
												key={hashForView(detailsView)}
												view={detailsView}
												working={detailsView.kind === "live" && subjectOf(detailsView, focused.host ?? null, focused.lastHost).working}
												cwd={focused.cwd ?? null}
												pullRequests={focused.row?.pullRequests ?? []}
												tickets={focused.row?.tickets ?? []}
												workspace={workspace}
												hosts={visible.hosts}
											/>
										</DashboardSidebar>
									)}
									{botPage && detailsBot && (
										<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
											<BotDetails
												key={detailsBot.id}
												bot={detailsBot}
												memory={state.botMemories[detailsBot.id] ?? ""}
												routines={state.routines}
												hosts={state.hosts}
												openRoutine={botPage.routine}
												connected={state.connected}
											/>
										</DashboardSidebar>
									)}
									<ShortcutsDialog open={overlays.shortcutsOpen} onOpenChange={setShortcutsOpen} tabs={barTabs} />
									{overlays.filePath !== null && <FileDialog key={overlays.filePath} path={overlays.filePath} onClose={() => setFilePath(null)} />}
									{overlays.newTicket !== null && <NewTicketDialog title={overlays.newTicket} onClose={() => setNewTicket(null)} />}
									<DiscussionPanel />
									<CommandPalette
										state={overlays.palette}
										dispatch={dispatchPalette}
										hosts={visible.hosts}
										past={visible.past}
										workspaces={workspaces}
										workspace={workspace}
										onOpenSession={openFromPalette}
										onPickWorkspace={switchWorkspace}
										pinned={sessions.pinned}
										onTogglePin={sessions.togglePin}
										handlers={handlers}
										unavailable={unavailable}
										tabs={barTabs}
										todoCategories={state.connected && state.userTodos ? state.userTodos.categories : null}
										todos={mentionLists.todos}
										notes={state.userNotes?.notes ?? null}
										linearConnected={linearCallable}
										onCreateTicket={setNewTicket}
									/>
								</SidebarProvider>
								<StatusBar usage={state.usage} hosts={state.hosts} terminalOpen={terminal.open} onToggleTerminal={terminal.toggle} />
								<DesktopLinkPreview />
							</div>
						</UserNotesContext.Provider>
					</UserTodosContext.Provider>
				</ScheduledSends.Provider>
			</DashboardStatusContext.Provider>
		</DashboardActionsContext.Provider>
	);
}
