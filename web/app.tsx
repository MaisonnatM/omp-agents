import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../src/shared";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { DashboardContext } from "./components/dashboard-context";
import { InboxPage } from "./components/inbox/inbox-page";
import { NewSession } from "./components/new-session";
import { Pane } from "./components/pane";
import { PlanPanel } from "./components/plan-panel";
import { PlanUsageFooter } from "./components/plan-usage";
import { Roster, type SidebarTab, useProject } from "./components/roster";
import { SettingsPage } from "./components/settings/settings-page";
import { SessionSwitcher } from "./components/session-switcher";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { DashboardSidebar, SidebarToggle, useSidebarPanels } from "./components/sidebar-panel";
import { SplitResizeHandle, splitAt, useSplitRatio } from "./components/split-resize-handle";
import { TicketsDisconnected, TicketsPage } from "./components/tickets/tickets-page";
import { ToolsExpanded } from "./components/transcript";
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
} from "./routing";
import type { SectionTarget } from "./section";
import { defaultCwd, discoverableSessions, listedViews, projectSwitch, sidebarSessions, workspaces } from "./sessions";
import { useShortcuts } from "./shortcuts";
import { startOf } from "./starts";
import { useStoredKeys } from "./stored-state";
import { useDashboard } from "./use-dashboard";

/** The session ids the sidebar lists under Pinned. */
const PINNED_KEY = "omp-agents.pinned-sessions";

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
	const [pinned, togglePin] = useStoredKeys(PINNED_KEY);
	const { started } = state;
	useEffect(() => {
		if (!started) return;
		const next = projectSwitch(project, started.cwd);
		if (next !== null) pickProject(next);
	}, [started]);
	const { layout } = state;
	const view = focusedView(layout);
	const viewHost = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;
	const title = documentTitle(page, view, viewHost ?? (view?.kind === "live" ? state.lastHosts.get(view.instanceId) ?? null : null), viewPast ?? null);
	useEffect(() => {
		document.title = title;
	}, [title]);
	const split = layout.panes.length > 1;
	const [columns, setColumns] = useSplitRatio("columns");
	const [rows, setRows] = useSplitRatio("rows");
	const maximized = layout.maximized && !page;
	const lists = sidebarSessions(visible.hosts, visible.past, project, pinned);
	// The running sessions the sidebar lists, in its order, which ending a session moves its panes along.
	const listedHosts = [...lists.pinned.hosts, ...lists.running].map(host => host.instanceId);
	const listed = listedViews(lists);
	const latest = useRef({ layout, listedHosts, sidebars });
	latest.current = { layout, listedHosts, sidebars };
	const endHost = useCallback((instanceId: string): void => {
		send({ t: "end", instanceId });
		show(endSession(latest.current.layout, instanceId, latest.current.listedHosts));
	}, [send, show]);
	const dashboard = useMemo(
		() => ({ send, open, focus, start, dismissStart, openNewSession, changeTodo, end: endHost, connected: state.connected, starts: { fork, resume, quick, resumeAll } }),
		[send, open, focus, start, dismissStart, openNewSession, changeTodo, endHost, state.connected, fork, resume, quick, resumeAll],
	);
	const onPaneLayout = useCallback((index: number, kind: "max" | "close") => {
		const current = latest.current.layout;
		show(kind === "max" ? { ...current, focus: index, maximized: !current.maximized } : closePane(current, index));
	}, [show]);
	/** The view whose plan and changes the right sidebar shows; a page has none, and neither do side-by-side panes, which leave no single view to follow. */
	const planView = page || (split && !maximized) ? null : view;
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const toggleRight = useCallback(() => toggleSidebar("right"), [toggleSidebar]);
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);

	const settingsPage: Page = { kind: "settings", cwd: page?.kind === "settings" ? page.cwd : (viewHost ?? viewPast)?.cwd || null };
	const settingsHref = hashForPage(settingsPage);
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [switcherOpen, setSwitcherOpen] = useState(false);
	const [sectionTarget, setSectionTarget] = useState<SectionTarget | null>(null);
	const linear = linearStore.usePolling();
	/** The Tickets tab and its shortcut show only once omp is signed in to Linear. */
	const ticketsShown = linear.read?.data.connected === true;
	const tab: SidebarTab = page?.kind === "inbox" || page?.kind === "todo" ? page.kind : page?.kind === "tickets" && ticketsShown ? "tickets" : "sessions";
	/** The category the Todo page shows; one another window removed shows every todo. */
	const todoCategory = page?.kind === "todo" && state.userTodos?.categories.some(({ id }) => id === page.category) ? page.category : null;
	const showTab = (next: SidebarTab): void => {
		if (next === "sessions") show(layout);
		else if (next === "todo") navigate({ kind: "todo", category: null });
		else navigate({ kind: next, target: null });
	};
	const step = (by: 1 | -1): boolean | void => {
		const next = adjacentSession(listed, view, by);
		if (!next) return false;
		open(next, "replace");
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
			if (page?.kind === "inbox") return false;
			showTab("inbox");
		},
		tickets: () => {
			if (page?.kind === "tickets" || !ticketsShown) return false;
			showTab("tickets");
		},
		sessions: () => {
			if (!page) return false;
			show(layout);
		},
		todo: () => {
			if (page?.kind === "todo") return false;
			showTab("todo");
		},
		restore: () => {
			if (!maximized) return false;
			show({ ...layout, maximized: false });
		},
	});



	let main: ReactNode;
	switch (page?.kind) {
		case "new": {
			const cwd = page.cwd ?? defaultCwd(view, visible.hosts, visible.past, project);
			main = (
				<NewSession
					cwd={cwd}
					workspaces={projects}
					launch={launch}
					connected={state.connected}
					completions={state.newSessionCompletions}
					onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
					onPickCwd={next => {
						// A failed start's error is about the directory left behind.
						dismissStart("new");
						location.hash = hashForNewSession(next);
					}}
					onStart={op => start({ kind: "new", cwd, ...op })}
				/>
			);
			break;
		}
		case "settings":
			main = <SettingsPage cwd={page.cwd} workspaces={projects} />;
			break;
		case "inbox":
			// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
			main = state.listed ? (
				<InboxPage project={project} hosts={visible.hosts} past={visible.past} target={page.target} section={sectionTarget} />
			) : (
				<p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>
			);
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
		case "todo":
			main = <TodoPage list={state.userTodos} category={todoCategory} disabled={!state.connected} onChange={changeTodo} />;
			break;
		case undefined:
			if (layout.panes.length > 0) {
				main = (
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
						{split && !maximized && (
							<SplitResizeHandle axis="columns" ratio={columns} onRatio={setColumns} span={layout.panes.length === 3 ? rows : 1} />
						)}
						{layout.panes.length > 2 && !maximized && <SplitResizeHandle axis="rows" ratio={rows} onRatio={setRows} />}
					</div>
				);
			} else if (state.hosts.length === 0) {
				main = <EmptyState rosterError={state.rosterError} />;
			} else {
				main = (
					<p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
						Select a session to see its conversation. {SPLIT_CLICK} more to see up to four side by side.
					</p>
				);
			}
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
						onTogglePin={togglePin}
						open={page ? [] : layout.panes}
						newSessionOpen={page?.kind === "new"}
						settingsHref={settingsHref}
						settingsOpen={page?.kind === "settings"}
						ticketsShown={ticketsShown}
						tab={tab}
						onTab={showTab}
						userTodos={state.userTodos}
						todoCategory={todoCategory}
						sectionTarget={sectionTarget}
						onSectionTarget={setSectionTarget}
						project={project}
						onPickProject={pickProject}
						onShowShortcuts={() => setShortcutsOpen(true)}
						toggle={<SidebarToggle side="left" open onToggle={() => toggleSidebar("left")} />}
					/>
					<PlanUsageFooter usage={state.usage} />
				</DashboardSidebar>
				<SidebarInset>
					<ToolsExpanded value={toolsExpanded}>{main}</ToolsExpanded>
				</SidebarInset>
				{planView && (
					<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
						<PlanPanel key={hashForView(planView)} view={planView} />
					</DashboardSidebar>
				)}
				<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
				/>
			</SidebarProvider>
		</DashboardContext.Provider>
	);
}
