import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { View } from "../src/shared";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
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
import { SPLIT_CLICK } from "./labels";
import { linearStore } from "./reads";
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
import { defaultCwd, listedViews, sidebarSessions, workspaces } from "./sessions";
import { useShortcuts } from "./shortcuts";
import { startOf } from "./starts";
import { useStoredKeys } from "./stored-state";
import { useDashboard } from "./use-dashboard";

/** The session ids the sidebar lists under Pinned. */
const PINNED_KEY = "omp-agents.pinned-sessions";

function EmptyState({ rosterError }: { rosterError: string | null }) {
	return (
		<section className="m-auto max-w-lg space-y-3 p-8 text-sm">
			<h2 className="text-base font-semibold">No omp sessions are published</h2>
			<p>
				Sessions publish themselves to the local Collab registry when <code>collab.autoStart</code> is <code>control</code>{" "}
				(or <code>view</code> for read-only):
			</p>
			<pre className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
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
	const [project, pickProject] = useProject(workspaces(state.hosts, state.past));
	const [pinned, togglePin] = useStoredKeys(PINNED_KEY);
	const { started } = state;
	// A session started in another directory than the selected project would be missing from the sidebar.
	useEffect(() => {
		if (started && project !== null && started.cwd !== project) pickProject(started.cwd);
	}, [started]);
	const { layout } = state;
	const view = focusedView(layout);
	const viewHost = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;
	const split = layout.panes.length > 1;
	const [columns, setColumns] = useSplitRatio("columns");
	const [rows, setRows] = useSplitRatio("rows");
	const maximized = layout.maximized && !page;
	const lists = sidebarSessions(state.hosts, state.past, project, pinned);
	// The running sessions the sidebar lists, in its order, which ending a session moves its panes along.
	const listedHosts = [...lists.pinned.hosts, ...lists.running].map(host => host.instanceId);
	const listed = listedViews(lists);
	const latest = useRef({ layout, listedHosts, sidebars });
	latest.current = { layout, listedHosts, sidebars };
	const endHost = useCallback((instanceId: string): void => {
		send({ t: "end", instanceId });
		show(endSession(latest.current.layout, instanceId, latest.current.listedHosts));
	}, [send, show]);
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
			const cwd = page.cwd ?? defaultCwd(view, state.hosts, state.past, project);
			main = (
				<NewSession
					cwd={cwd}
					workspaces={workspaces(state.hosts, state.past)}
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
			main = <SettingsPage cwd={page.cwd} workspaces={workspaces(state.hosts, state.past)} />;
			break;
		case "inbox":
			// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
			main = state.listed ? (
				<InboxPage
					project={project}
					hosts={state.hosts}
					past={state.past}
					target={page.target}
					onOpen={open}
					section={sectionTarget}
					quick={quick}
					onQuickAction={start}
					onDismissQuick={() => dismissStart("quick")}
				/>
			) : (
				<p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>
			);
			break;
		case "tickets":
			if (linear.read && !ticketsShown) main = <TicketsDisconnected />;
			// Until the sessions are listed, the workspace a quick action starts in is not known yet.
			else if (state.listed) {
				main = (
					<TicketsPage
						target={page.target}
						section={sectionTarget}
						cwd={defaultCwd(view, state.hosts, state.past, project)}
						quick={quick}
						onQuickAction={start}
						onDismissQuick={() => dismissStart("quick")}
						onOpen={open}
					/>
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
						className="relative grid h-svh min-h-0 gap-px bg-border"
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
								models={pane.kind === "live" ? state.models.get(pane.instanceId) ?? null : null}
								fork={fork}
								resume={resume}
								send={send}
								startSession={start}
								focus={focus}
								open={open}
								onEnd={endHost}
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
		<SidebarProvider persist={false} shortcut={null} className="h-svh">
			<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
				<Roster
					hosts={state.hosts}
					past={state.past}
					lists={lists}
					onTogglePin={togglePin}
					open={page ? [] : layout.panes}
					connected={state.connected}
					newSessionOpen={page?.kind === "new"}
					settingsHref={settingsHref}
					settingsOpen={page?.kind === "settings"}
					ticketsShown={ticketsShown}
					tab={tab}
					onTab={showTab}
					userTodos={state.userTodos}
					todoCategory={todoCategory}
					onTodoChange={changeTodo}
					sectionTarget={sectionTarget}
					onSectionTarget={setSectionTarget}
					project={project}
					onPickProject={pickProject}
					onOpen={open}
					onNewSession={openNewSession}
					resume={resume}
					onResume={sessionId => {
						// The pane shows the resume's progress and failure, and the live session takes it over.
						open({ kind: "past", sessionId }, "replace");
						start({ kind: "resume", sessionId });
					}}
					resumeAll={resumeAll}
					onResumeAll={sessionIds => start({ kind: "resume-all", sessionIds })}
					onDismissResumeAll={() => dismissStart("resume-all")}
					onDismissInterrupted={sessionId => send({ t: "dismiss-interrupted", sessionId })}
					onEnd={endHost}
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
				hosts={state.hosts}
				past={state.past}
				onPick={(picked, cwd) => {
					// As a started session does, a session from another project switches the sidebar to its project.
					if (project !== null && cwd !== project) pickProject(cwd);
					open(picked, "replace");
				}}
			/>
		</SidebarProvider>
	);
}
