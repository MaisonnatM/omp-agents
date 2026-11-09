import { useCallback, useMemo, useRef, useState } from "react";
import { callable } from "../src/shared/accounts";
import type { View } from "../src/shared/sessions";
import { otherSpace, type Space } from "../src/shared/workspaces";
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
	PersonalContext,
	UserNotesContext,
	UserTodosContext,
} from "./components/dashboard-context";
import { DesktopLinkPreview } from "./components/desktop-link-preview";
import { FileDialog } from "./components/file-dialog";
import { textFileUrl } from "./file-paths";
import { newDraftCwd, PageSwitch } from "./components/page-switch";
import { NO_PLANS, Plans } from "./components/plan-usage";
import { useNoticeToasts } from "./components/use-notice-toasts";
import { RenderBoundary } from "./components/render-boundary";
import { ScheduledSends } from "./components/scheduled";
import { SessionDetails } from "./components/session-details";
import { GoalDialog } from "./components/session-goal";
import { ProjectTrustDialog } from "./components/project-trust-dialog";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { GetStarted } from "./components/get-started";
import { firstSessionFact } from "./get-started-model";
import { DashboardSidebar, useSidebarPanels } from "./components/sidebar-panel";
import { StatusBar } from "./components/status-bar";
import { subjectOf } from "./components/subject";
import { NewTicketDialog } from "./components/tickets/new-ticket";
import { TerminalPanel, useTerminalPanel } from "./components/terminal/terminal-panel";
import { ActivityVisibility, ToolsExpanded } from "./components/transcript";
import { toasts } from "./components/toaster";
import { botRows } from "./bots-model";
import { routeOf } from "./dashboard-state";
import { useOpenPullRequest } from "./open-pull-request";
import { integrationsStore } from "./reads";
import { EMPTY_LAYOUT, hashForLayout, hashForPage, hashForRoute, hashForView, type NotesListView, type OpenMode, type TodoListView } from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, spaceSwitchPanes, type WindowScope, waitingIn, workspaceSession, workspaceSwitch } from "./sessions";
import { placedTabs, useSidebarTabs } from "./sidebar-tabs";
import { refusedStart, startOf } from "./starts";
import { useAttention } from "./use-attention";
import { useDashboard } from "./use-dashboard";
import { useFocusedSession } from "./use-focused-session";
import { useOverlays } from "./use-overlays";
import { usePageShortcuts } from "./use-page-shortcuts";
import { useSessionLists } from "./use-session-lists";
import { useSettingsRoute, useSidebarTab } from "./use-sidebar-tab";
import { useTranscriptDisplay } from "./use-transcript-display";
import { useWorkspaceScope } from "./use-workspace-scope";

const ALL_TODOS: TodoListView = { kind: "all" };
const ALL_NOTES: NotesListView = { kind: "all" };

/**
 * The dashboard: the socket's state, sliced into what each part reads, and the parts. Each hook it calls owns one
 * slice, and the two dashboard contexts split what is stable, the actions, from what changes, the connection and the starts.
 */
export function App() {
	const { state, page, openBot, send, request, end, open, focus, show, close, resize, navigate, openNewSession, dismissStart, start, changeTodo, changeNote, changeSport, changePins, changeBot, trustAndStart, dismissTrust } = useDashboard();

	const { layout } = state;
	const sidebars = useSidebarPanels();
	const scope = useWorkspaceScope(state);
	const { visible, workspaces, workspace, pickWorkspace, hiddenCwds, space, pickSpace, pullRequestsScope, spaces, home } = scope;
	const windowScope = useMemo((): WindowScope => ({ space, spaces, workspace, home }), [space, spaces, workspace, home]);
	const focused = useFocusedSession(state, page, scope);
	const sessions = useSessionLists(scope, state.pins, changePins);
	const overlays = useOverlays();
	const display = useTranscriptDisplay();
	const terminal = useTerminalPanel();
	useNoticeToasts(state.notices, state.connected, send, start);
	useAttention(state, openBot?.view ?? null, send);
	/** How many sessions the space off screen lists need you, which the switch counts on its side; none until the spaces are known. */
	const otherWaiting = useMemo(
		() => (state.connected && scope.spacesKnown ? waitingIn(scope.everySpace, otherSpace(space), spaces) : 0),
		[state.connected, scope.spacesKnown, scope.everySpace, space, spaces],
	);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const [goalEditor, setGoalEditor] = useState<{ instanceId: string; focus: "objective" | "budget" } | null>(null);
	const editGoal = useCallback((instanceId: string, focus: "objective" | "budget") => setGoalEditor({ instanceId, focus }), []);
	const goalHost = goalEditor ? state.hosts.find(host => host.instanceId === goalEditor.instanceId) : null;
	const editedGoal = goalHost?.source === "dashboard" && goalHost.goal.kind !== "off" && goalHost.control.phase === "live" && !goalHost.control.readOnly ? goalHost : null;
	const integrations = integrationsStore.usePolling().read?.data.integrations;
	const linear = integrations?.linear ?? null;
	const { absent: absentTabs, shown: tabs } = useSidebarTabs(space);
	/** The dashboard reads and writes Linear: the tickets page lists issues, the Todo page creates them, and the Calendar shows their due days. */
	const linearCallable = linear !== null && callable(linear.connection);
	/** Linear answers and the space shows Tickets: the new-ticket shortcut and the palette's tickets apply. */
	const ticketsCallable = linearCallable && !absentTabs.has("tickets");
	const settings = useSettingsRoute(page);
	const latestBot = useMemo(() => (state.bots === null ? null : (botRows(state.bots, state.hosts, state.botLasts)[0]?.bot.id ?? null)), [state.bots, state.hosts, state.botLasts]);
	const { tab, showTab } = useSidebarTab({ page, absentTabs, layout, latestSession: sessions.latest, latestBot, navigate, show });
	/** The tabs the bar draws, which Cmd+1 onward go to in order. */
	const barTabs = useMemo(() => placedTabs(tabs, "bar"), [tabs]);
	const headerTabs = useMemo(() => placedTabs(tabs, "header"), [tabs]);
	const maximized = layout.maximized && !page;
	const address = page ? hashForPage(page) : hashForLayout(layout);
	/** The view whose details the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const detailsView = page || (layout.panes.length > 1 && !maximized) ? null : focused.view;
	const defaultWorkspace = defaultCwd(focused.view, visible.hosts, visible.past, windowScope);
	// The live rows of the sessions list, whose order ending a session moves its panes along.
	const listedHosts = sessions.listed.flatMap(view => (view.kind === "live" ? view.instanceId : []));
	const latest = useRef({ layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, shownWorkspace: focused.workspace, scope });
	latest.current = { layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, shownWorkspace: focused.workspace, scope };

	const endHost = useCallback(
		async (instanceId: string): Promise<boolean> => {
			if (latest.current.ending.has(instanceId)) return false;
			try {
				await end(instanceId, latest.current.listedHosts);
				return true;
			} catch (error) {
				toasts.add({ title: "Could not end the session", description: errorText(error) });
				return false;
			}
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
			const { page, hosts, shownWorkspace } = latest.current;
			const next = page ? null : workspaceSession(cwd, hosts, shownWorkspace);
			if (next) open(next, "replace");
		},
		[pickWorkspace, open],
	);
	const switchSpace = useCallback(
		(next: Space): void => {
			const { page, layout, scope } = latest.current;
			if (next === scope.space) return;
			pickSpace(next);
			// The route follows the space the user picks; `useFocusedSession` follows the route into its space the other way.
			const panes = spaceSwitchPanes(page, layout, scope.space, next, scope.everySpace.hosts, scope.spaces);
			if (panes === "empty") show(EMPTY_LAYOUT);
			else if (panes !== "stay") open(panes, "replace");
		},
		[pickSpace, open, show],
	);
	const toggleSpace = useCallback(() => switchSpace(otherSpace(latest.current.scope.space)), [switchSpace]);
	/** The palette opens a session from any workspace, so the sidebar switches to that workspace to keep it listed. */
	const openFromPalette = useCallback(
		(picked: View, sessionWorkspace: string, mode: OpenMode): void => {
			const next = workspaceSwitch(workspace, sessionWorkspace, hiddenCwds);
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

	const { setShortcutsOpen, setOpenedFile, setNewTicket, dispatchPalette } = overlays;
	// The command menu's **Open pull request** acts on the focused pane's session while the panes show, as its header's **Open PR** does.
	const openPullRequest = useOpenPullRequest(page ? null : focused.view, focused.host, request);
	const focusedGoal = page === null && focused.view?.kind === "live" && focused.view.agentId === null && focused.host?.source === "dashboard" && focused.host.goal.kind !== "off" && focused.host.control.phase === "live" && !focused.host.control.readOnly ? focused.host : null;
	const { handlers, unavailable } = usePageShortcuts({
		page,
		layout,
		maximized,
		tab,
		settings,
		listed: sessions.listed,
		view: focused.view,
		absentTabs,
		tabs: barTabs,
		ticketsCallable,
		hasDetails: detailsView !== null || openBot !== null,
		openPullRequest: openPullRequest.state.kind === "ready" ? openPullRequest.run : null,
		setGoal: focusedGoal ? () => editGoal(focusedGoal.instanceId, "objective") : null,
		palette: overlays.palette,
		dispatchPalette,
		setShortcutsOpen,
		setNewTicket,
		openNewSession,
		toggleSpace,
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
		(): DashboardActions => ({ send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeNote, changeSport, changeBot, end: endHost, openFile: setOpenedFile, openNewTicket: setNewTicket, editGoal, workspaceSettings }),
		[send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeNote, changeSport, changeBot, endHost, setOpenedFile, setNewTicket, editGoal, workspaceSettings],
	);
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const resumeAll = startOf(state.starts, "resume-all");
	const refused = refusedStart(state.starts);
	// The scope whose pull requests `useWorkspaceScope` polls, so the `@` menu reads the entry the page keeps current.
	const status = useMemo(
		(): DashboardStatus => ({ connected: state.connected, starts: { fork, resume, quick, resumeAll }, ending: state.ending, pullRequestsScope, scope: windowScope, merges: state.merges, reviewDrafts: state.reviewDrafts }),
		[state.connected, fork, resume, quick, resumeAll, state.ending, pullRequestsScope, windowScope, state.merges, state.reviewDrafts],
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
				tabs={headerTabs}
				tab={tab}
				onTab={showTab}
				settingsOpen={page?.kind === "settings"}
				onToggleSettings={toggleSettings}
				space={space}
				onSpace={switchSpace}
				otherWaiting={otherWaiting}
			/>
		),
		[state.notices, showSearch, headerTabs, tab, showTab, page?.kind, toggleSettings, space, switchSpace, otherWaiting],
	);

	return (
		<DashboardActionsContext.Provider value={actions}>
			<DashboardStatusContext.Provider value={status}>
				<ScheduledSends.Provider value={state.scheduled}>
					<UserTodosContext.Provider value={state.userTodos}>
						<UserNotesContext.Provider value={state.userNotes}>
							<PersonalContext.Provider value={state.personal}>
								<div className="flex h-svh flex-col">
									{DESKTOP_TITLE_BAR && <DesktopTitleBar title={focused.title} space={space} onSpace={switchSpace} otherWaiting={otherWaiting} controls={headerControls} />}
									<SidebarProvider className="min-h-0 flex-1">
										<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")} address={address}>
											<AppSidebar
												scope={scope}
												sessions={sessions}
												page={page}
												newDraftDir={page?.kind === "new" ? newDraftCwd(page, state.userTodos, defaultWorkspace) : null}
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
																		sport={state.sport}
																		routines={state.routines}
																		bots={state.bots}
																		botLasts={state.botLasts}
																		openBot={openBot}
																		workspaceList={state.workspaceList}
																		personal={state.personal}
																		trustedProjects={state.trustedProjects}
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
										{(detailsView || openBot) && (
											<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")} address={address}>
												{detailsView ? (
													<SessionDetails
														key={hashForView(detailsView)}
														view={detailsView}
														working={detailsView.kind === "live" && subjectOf(detailsView, focused.host ?? null, focused.lastHost).working}
														cwd={focused.cwd ?? null}
														personalMemory={focused.cwd !== undefined && spaces.of(focused.cwd, focused.workspace ?? focused.cwd) === "personal" ? state.personalMemory : null}
														pullRequests={focused.row?.pullRequests ?? []}
														tickets={focused.row?.tickets ?? []}
														hosts={visible.hosts}
													/>
												) : (
													openBot && (
														<BotDetails
															key={openBot.bot.id}
															open={openBot}
															session={openBot.host ?? state.past.find(({ sessionId }) => sessionId === openBot.bot.sessionId) ?? null}
															memory={state.botMemories[openBot.bot.id] ?? ""}
															connected={state.connected}
														/>
													)
												)}
											</DashboardSidebar>
										)}
										<ShortcutsDialog open={overlays.shortcutsOpen} onOpenChange={setShortcutsOpen} tabs={barTabs} />
										{refused && <ProjectTrustDialog key={refused.reqId} ask={refused.trust} connected={state.connected} onTrust={() => trustAndStart(refused)} onCancel={() => dismissTrust(refused.reqId)} />}
										<GetStarted
											route={page?.kind === "get-started"}
											vacantHome={!page && layout.panes.length === 0}
											firstSession={firstSessionFact({ hosts: state.hosts.length, past: state.past.length, listed: state.listed, connected: state.connected, rosterError: state.rosterError })}
											rosterError={state.rosterError}
											onClose={() => show(layout)}
										/>
										{overlays.openedFile !== null && <FileDialog key={textFileUrl(overlays.openedFile)} target={overlays.openedFile} onClose={() => setOpenedFile(null)} />}
										{overlays.newTicket !== null && <NewTicketDialog title={overlays.newTicket} onClose={() => setNewTicket(null)} />}
										{goalEditor && editedGoal && editedGoal.goal.kind !== "off" && (
											<GoalDialog
												key={goalEditor.instanceId}
												goal={editedGoal.goal.kind === "set" && editedGoal.goal.goal.status !== "complete" ? editedGoal.goal.goal : null}
												focus={goalEditor.focus}
												continues={editedGoal.goal.continues}
												onClose={() => setGoalEditor(null)}
												onSave={async change => { await request({ t: "goal", instanceId: goalEditor.instanceId, change }); setGoalEditor(null); }}
											/>
										)}
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
											ticketsCallable={ticketsCallable}
											onCreateTicket={setNewTicket}
										/>
									</SidebarProvider>
									<StatusBar usage={state.usage} hosts={state.hosts} bots={state.bots} terminalOpen={terminal.open} onToggleTerminal={terminal.toggle} />
									<DesktopLinkPreview />
								</div>
							</PersonalContext.Provider>
						</UserNotesContext.Provider>
					</UserTodosContext.Provider>
				</ScheduledSends.Provider>
			</DashboardStatusContext.Provider>
		</DashboardActionsContext.Provider>
	);
}
