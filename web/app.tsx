import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../src/shared/sessions";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { errorText } from "../src/json";
import { AppSidebar } from "./components/app-sidebar";
import { BotDetails } from "./components/bots/bot-details";
import { CommandPalette } from "./components/command-palette/command-palette";
import { HeaderTabs } from "./components/header-tabs";
import {
	type DashboardActions,
	DashboardActionsContext,
	type DashboardStatus,
	DashboardStatusContext,
	MentionListsContext,
	OpenProjectsContext,
	UserTodosContext,
} from "./components/dashboard-context";
import { LinkPreviewCard } from "./components/link-preview-card";
import { FileDialog } from "./components/file-dialog";
import { textFileUrl } from "./file-paths";
import { PageSwitch } from "./components/page-switch";
import { useModulesOff } from "./modules-off";
import { openProjects, type Project } from "../src/shared/projects";
import { PageList, PageListColumn, useWidth } from "./components/page-list";
import { listPageOf, listPlacement } from "./page-list";
import { NO_PLANS, Plans } from "./components/plan-usage";
import { useNoticeToasts } from "./components/use-notice-toasts";
import { RenderBoundary } from "./components/render-boundary";
import { ScheduledSends } from "./components/scheduled";
import { SessionDetails, TAB_KEY } from "./components/session-details";
import { GoalDialog } from "./components/session-goal";
import { ProjectTrustDialog } from "./components/project-trust-dialog";
import { GetStarted } from "./components/get-started";
import { firstSessionFact } from "./get-started-model";
import { DashboardSidebar, useSidebarPanels } from "./components/sidebar-panel";
import { SidebarFoot } from "./components/sidebar-status";
import { subjectOf } from "./components/subject";
import { TerminalPanel, useTerminalPanel } from "./components/terminal/terminal-panel";
import { ActivityVisibility, ToolsExpanded } from "./components/transcript";
import { toasts } from "./components/toaster";
import { botRows } from "./bots-model";
import { routeOf } from "./dashboard-state";
import { useOpenPullRequest } from "./open-pull-request";
import { UNREAD } from "./reads";
import { onArtifactOpen, onArtifactsReveal } from "./artifact-requests";
import { onReviewRequest } from "./review-pages";
import { revealDetailsTab } from "./details-tabs";
import { hashForLayout, hashForPage, hashForRoute, hashForView, type OpenMode, sameView } from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, type WindowScope, workspaceSession, workspaceSwitch } from "./sessions";
import { useSidebarTabs } from "./sidebar-tabs";
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

const NO_PROJECTS: readonly Project[] = [];

/**
 * The dashboard: the socket's state, sliced into what each part reads, and the parts. Each hook it calls owns one
 * slice, and the two dashboard contexts split what is stable, the actions, from what changes, the connection and the starts.
 */
export function App() {
	const { state, page, openBot, send, request, end, open, focus, show, close, resize, navigate, openNewSession, dismissStart, start, changeTodo, changeModule, changePins, changeBot, trustAndStart, dismissTrust } = useDashboard();

	const { layout } = state;
	const sidebars = useSidebarPanels();
	const scope = useWorkspaceScope(state);
	const { visible, workspaces, workspace, pickWorkspace, hiddenCwds, pullRequestsScope } = scope;
	const windowScope = useMemo((): WindowScope => ({ workspace }), [workspace]);
	const focused = useFocusedSession(state, page, scope);
	const [modulesOff] = useModulesOff();
	const projectList = state.modules.projects;
	const projects = useMemo((): readonly Project[] => (projectList === null || modulesOff.has("projects") ? NO_PROJECTS : openProjects(projectList)), [projectList, modulesOff]);
	const sessions = useSessionLists(scope, state.pins, changePins, projects);
	const overlays = useOverlays();
	const display = useTranscriptDisplay();
	const terminal = useTerminalPanel();
	useNoticeToasts(state.notices, state.connected, send, start);
	useAttention(state, openBot?.view ?? null, send);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const [goalEditor, setGoalEditor] = useState<{ instanceId: string; focus: "objective" | "budget" } | null>(null);
	const editGoal = useCallback((instanceId: string, focus: "objective" | "budget") => setGoalEditor({ instanceId, focus }), []);
	const goalHost = goalEditor ? state.hosts.find(host => host.instanceId === goalEditor.instanceId) : null;
	const editedGoal = goalHost?.source === "dashboard" && goalHost.goal.kind !== "off" && goalHost.control.phase === "live" && !goalHost.control.readOnly ? goalHost : null;
	const { absent: absentTabs, shown: tabs } = useSidebarTabs();
	const settings = useSettingsRoute(page);
	const botList = useMemo(() => (state.bots === null ? null : botRows(state.bots, state.hosts, state.botLasts)), [state.bots, state.hosts, state.botLasts]);
	const latestBot = botList?.[0]?.bot.id ?? null;
	const { row, showTab } = useSidebarTab({ page, absentTabs, layout, latestSession: sessions.latest, latestBot, navigate, show });
	const maximized = layout.maximized && !page;
	const address = page ? hashForPage(page) : hashForLayout(layout);
	/** The view whose details the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const detailsView = page || (layout.panes.length > 1 && !maximized) ? null : focused.view;
	const defaultWorkspace = defaultCwd(focused.view, visible.hosts, visible.past, windowScope);
	// The live rows of the sessions list, whose order ending a session moves its panes along.
	const listedHosts = sessions.listed.flatMap(view => (view.kind === "live" ? view.instanceId : []));
	const latest = useRef({ layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, shownWorkspace: focused.workspace, detailsView });
	latest.current = { layout, listedHosts, ending: state.ending, sidebars, page, hosts: visible.hosts, shownWorkspace: focused.workspace, detailsView };

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
	const showDetailsTab = useCallback((tab: "browser" | "artifacts"): void => {
		revealDetailsTab(TAB_KEY, tab, "overview");
		latest.current.sidebars.setOpen("right", true);
	}, []);
	// A reply's **Review visuals** shows the Browser, whose panel then opens the reply's pages.
	useEffect(() => onReviewRequest(() => showDetailsTab("browser")), [showDetailsTab]);
	// A save in the view whose details show brings its Artifacts tab into sight.
	useEffect(
		() =>
			onArtifactsReveal(view => {
				const { detailsView } = latest.current;
				if (detailsView && sameView(detailsView, view)) showDetailsTab("artifacts");
			}),
		[showDetailsTab],
	);
	// A card's Open does so from any pane, first filling the page with that pane when others share it, since side-by-side panes show no details.
	useEffect(
		() =>
			onArtifactOpen(view => {
				const { layout, page } = latest.current;
				const index = layout.panes.findIndex(each => sameView(each, view));
				if (page || index < 0) return;
				if (layout.panes.length > 1 && !(layout.maximized && layout.focus === index)) show({ ...layout, focus: index, maximized: true });
				showDetailsTab("artifacts");
			}),
		[show, showDetailsTab],
	);
	const switchWorkspace = useCallback(
		(cwd: string | null): void => {
			pickWorkspace(cwd);
			// A page such as the pull requests stays; only the panes follow the sidebar into the workspace.
			const { page, hosts, shownWorkspace } = latest.current;
			const next = page ? null : workspaceSession(cwd, hosts, shownWorkspace);
			if (next) open(next, "replace");
		},
		[pickWorkspace, open],
	);
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

	const { setOpenedFile, dispatchPalette } = overlays;
	// The command menu's **Open pull request** acts on the focused pane's session while the panes show and that session's branch can take a pull request, as `offeredPrompt` says.
	const openPullRequest = useOpenPullRequest(page ? null : focused.view, focused.host, request);
	const focusedGoal = page === null && focused.view?.kind === "live" && focused.view.agentId === null && focused.host?.source === "dashboard" && focused.host.goal.kind !== "off" && focused.host.control.phase === "live" && !focused.host.control.readOnly ? focused.host : null;
	const unavailable = usePageShortcuts({
		page,
		layout,
		maximized,
		settings,
		listed: sessions.listed,
		view: focused.view,
		absentTabs,
		hasDetails: detailsView !== null || openBot !== null,
		openPullRequest: openPullRequest.state.kind === "ready" ? openPullRequest.run : null,
		setGoal: focusedGoal ? () => editGoal(focusedGoal.instanceId, "objective") : null,
		palette: overlays.palette,
		dispatchPalette,
		openNewSession,
		open,
		show,
		navigate,
		showTab,
		toggleSidebar,
		showBrowser: () => showDetailsTab("browser"),
		toggleTools: display.toggleTools,
		toggleHideTools: display.toggleHideTools,
		toggleHideThinking: display.toggleHideThinking,
	});

	const actions = useMemo(
		(): DashboardActions => ({ send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeModule, changeBot, end: endHost, openFile: setOpenedFile, editGoal, workspaceSettings }),
		[send, request, open, focus, start, dismissStart, openNewSession, changeTodo, changeModule, changeBot, endHost, setOpenedFile, editGoal, workspaceSettings],
	);
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const pullRequestNew = startOf(state.starts, "pull-request-new");
	const resumeAll = startOf(state.starts, "resume-all");
	const refused = refusedStart(state.starts);
	// The scope whose pull requests `useWorkspaceScope` polls, so the `@` menu reads the entry the page keeps current.
	const status = useMemo(
		(): DashboardStatus => ({ connected: state.connected, starts: { fork, resume, quick, pullRequestNew, resumeAll }, ending: state.ending, pullRequestsScope, scope: windowScope, merges: state.merges, reviewDrafts: state.reviewDrafts }),
		[state.connected, fork, resume, quick, pullRequestNew, resumeAll, state.ending, pullRequestsScope, windowScope, state.merges, state.reviewDrafts],
	);
	const mentionLists = useMemo(() => ({ todos: state.userTodos?.todos ?? [], hosts: visible.hosts, past: visible.past }), [state.userTodos, visible]);

	const listPage = listPageOf(page, row);
	const pageArea = useRef<HTMLDivElement>(null);
	const pageAreaWidth = useWidth(pageArea);
	const placement = listPage && listPlacement(listPage, sidebars.panels.left.floating, pageAreaWidth);
	const pageList = useMemo(
		() =>
			listPage && (
				<PageList
					page={listPage}
					botList={botList}
					sectionTarget={sectionTarget}
					onSectionTarget={setSectionTarget}
				/>
			),
		[listPage, botList, sectionTarget],
	);
	const showSearch = useCallback(() => dispatchPalette({ type: "open" }), [dispatchPalette]);
	const unreadNotices = useMemo(() => state.notices.filter(notice => !notice.read).length, [state.notices]);

	return (
		<DashboardActionsContext.Provider value={actions}>
			<DashboardStatusContext.Provider value={status}>
				<ScheduledSends.Provider value={state.scheduled}>
					<UserTodosContext.Provider value={state.userTodos}>
					<OpenProjectsContext.Provider value={projects}>
						<div className="flex h-svh flex-col bg-sidebar">
							{/* The sidebar runs the window's height; the header's tabs sit right of it, above the page and the details sidebar, each an inset panel on the sidebar's color. */}
							<SidebarProvider
								className="group/window grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[var(--window-header-height)_minmax(0,1fr)] pr-1.5 pb-1.5 [grid-template-areas:'sidebar_tabs_tabs'_'sidebar_page_details']"
							>
								<DashboardSidebar side="left" className="[grid-area:sidebar]" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")} address={address}>
									<AppSidebar
										scope={scope}
										sessions={sessions}
										page={page}
										panes={layout.panes}
										row={row}
										onTab={showTab}
										tabs={tabs}
										botList={botList}
										list={placement?.at === "sidebar" ? pageList : null}
										settings={settings}
										unreadNotices={unreadNotices}
										onPickWorkspace={switchWorkspace}
										onSearch={showSearch}
									/>
									<SidebarFoot usage={state.usage} />
								</DashboardSidebar>
								<HeaderTabs className="[grid-area:tabs]" address={address} hosts={state.hosts} past={state.past} />
								<SidebarInset className={cn("inset-panel [grid-area:page] group-has-[#sessions-sidebar[inert]]/window:ml-1.5", (detailsView || openBot) && sidebars.panels.right.open && !sidebars.panels.right.floating && "rounded-r-none border-r-0")}>
									<div ref={pageArea} className="flex min-h-0 flex-1">
										{listPage && placement?.at === "column" && (
											<PageListColumn page={listPage} max={placement.max}>
												{pageList}
											</PageListColumn>
										)}
										<div className="relative flex min-w-0 flex-1 flex-col">
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
																	modules={state.modules}
																	routines={state.routines}
																	bots={state.bots}
																	botLasts={state.botLasts}
																	openBot={openBot}
																	workspaceList={state.workspaceList}
																	trustedProjects={state.trustedProjects}
																	newSessionCompletions={state.newSessionCompletions}
																	connected={state.connected}
																	listed={state.listed}
																	rosterError={state.rosterError}
																	notices={state.notices}
																	newStart={startOf(state.starts, "new")}
																	scope={scope}
																	defaultWorkspace={defaultWorkspace}
																	sectionTarget={sectionTarget}
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
										</div>
									</div>
									<TerminalPanel panel={terminal} cwd={focused.workDir ?? workspace ?? "~"} />
								</SidebarInset>
								{(detailsView || openBot) && (
									<DashboardSidebar side="right" className="[grid-area:details]" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")} address={address}>
										{detailsView ? (
											// The **Subagent** tab draws a conversation, which reads the same settings the panes do.
											<Plans value={state.usage?.plans ?? NO_PLANS}>
												<ActivityVisibility.Provider value={display.activityVisibility}>
													<ToolsExpanded value={display.toolsExpanded}>
														<MentionListsContext.Provider value={mentionLists}>
															<SessionDetails
																key={hashForView(detailsView)}
																view={detailsView}
																working={detailsView.kind === "live" && subjectOf(detailsView, focused.host ?? null, focused.lastHost).working}
																cwd={focused.cwd ?? null}
																hosts={visible.hosts}
																sessionId={focused.sessionId}
																host={focused.host ?? null}
																lastHost={focused.lastHost}
																row={focused.row ?? null}
																models={(detailsView.kind === "live" && state.models.get(detailsView.instanceId)) || UNREAD}
																workspaces={workspaces}
															/>
														</MentionListsContext.Provider>
													</ToolsExpanded>
												</ActivityVisibility.Provider>
											</Plans>
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
								{refused && <ProjectTrustDialog key={refused.reqId} ask={refused.trust} connected={state.connected} onTrust={() => trustAndStart(refused)} onCancel={() => dismissTrust(refused.reqId)} />}
								<GetStarted
									route={page?.kind === "get-started"}
									vacantHome={!page && layout.panes.length === 0}
									firstSession={firstSessionFact({ hosts: state.hosts.length, past: state.past.length, listed: state.listed, connected: state.connected, rosterError: state.rosterError })}
									rosterError={state.rosterError}
									onClose={() => show(layout)}
								/>
								{overlays.openedFile !== null && <FileDialog key={textFileUrl(overlays.openedFile)} target={overlays.openedFile} onClose={() => setOpenedFile(null)} />}
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
									unavailable={unavailable}
									todoCategories={state.connected && state.userTodos ? state.userTodos.categories : null}
									todos={mentionLists.todos}
								/>
							</SidebarProvider>
							<LinkPreviewCard />
						</div>
					</OpenProjectsContext.Provider>
					</UserTodosContext.Provider>
				</ScheduledSends.Provider>
			</DashboardStatusContext.Provider>
		</DashboardActionsContext.Provider>
	);
}
