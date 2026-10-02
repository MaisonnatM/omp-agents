import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { View } from "../src/shared";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { InboxPage } from "./components/inbox/inbox-page";
import { NewSession } from "./components/new-session";
import { Pane } from "./components/pane";
import { PlanUsageFooter } from "./components/plan-usage";
import { Roster, useProject } from "./components/roster";
import { SettingsPage } from "./components/settings/settings-page";
import { SessionSwitcher } from "./components/session-switcher";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { SubagentsSidebar } from "./components/subagents-sidebar";
import { DashboardSidebar, SidebarToggle, useSidebarPanels } from "./components/sidebar-panel";
import { SplitResizeHandle, splitAt, storedSplitRatio } from "./components/split-resize-handle";
import { ToolsExpanded } from "./components/transcript";
import { type InboxTarget } from "./inbox-model";
import { SPLIT_CLICK } from "./labels";
import {
	adjacentSession,
	closePane,
	endSession,
	focusedView,
	hashForSettings,
	hashForInbox,
	hashForView,
	inboxFromHash,
	newSessionFromHash,
	sameView,
	settingsFromHash,
} from "./routing";
import { defaultCwd, workspaces } from "./sessions";
import { useShortcuts } from "./shortcuts";
import { startOf } from "./starts";
import { useDashboard, useHash } from "./use-dashboard";

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
	const { state, send, open, focus, show, openNewSession, dismissStart, start, resumeAll, dismissResumeAll } = useDashboard();
	const launch = startOf(state.starts, "new");
	const fork = startOf(state.starts, "fork");
	const resume = startOf(state.starts, "resume");
	const quick = startOf(state.starts, "quick");
	const sidebars = useSidebarPanels();
	const hash = useHash();
	const settings = settingsFromHash(hash);
	const inbox = inboxFromHash(hash);
	const newSession = newSessionFromHash(hash);
	const page = settings || inbox || newSession;
	const [project, pickProject] = useProject(workspaces(state.hosts, state.past));
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
	const [columns, setColumns] = useState(() => storedSplitRatio("columns"));
	const [rows, setRows] = useState(() => storedSplitRatio("rows"));
	const maximized = layout.maximized && !page;
	const inProject = (row: { cwd: string }): boolean => project === null || row.cwd === project;
	// The running sessions the sidebar lists, in its order, which ending a session moves its panes along.
	const listedHosts = state.hosts.filter(inProject).map(host => host.instanceId);
	/** Every row of the sidebar's sessions list, running, then interrupted, then past, which the previous and next session keys walk. */
	const listedViews: View[] = [
		...listedHosts.map((instanceId): View => ({ kind: "live", instanceId, agentId: null })),
		...state.past
			.filter(inProject)
			.toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted))
			.map(({ sessionId }): View => ({ kind: "past", sessionId })),
	];
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
	/** The live session whose subagents the right sidebar lists. Over a past session or a page, it has none. */
	const subagentsHost = page ? undefined : viewHost;
	const toggleSidebar = useCallback((side: SidebarSide): void => {
		const { sidebars } = latest.current;
		sidebars.setOpen(side, !sidebars.panels[side].open);
	}, []);
	const toggleRight = useCallback(() => toggleSidebar("right"), [toggleSidebar]);
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);

	const settingsHref = hashForSettings(settings ? settings.cwd : (viewHost ?? viewPast)?.cwd || null);
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [switcherOpen, setSwitcherOpen] = useState(false);
	const [inboxTarget, setInboxTarget] = useState<InboxTarget | null>(null);
	const showInbox = (open: boolean): void => {
		if (open) location.hash = hashForInbox(null);
		else show(layout);
	};
	const step = (by: 1 | -1): boolean | void => {
		const next = adjacentSession(listedViews, view, by);
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
		subagentsSidebar: () => {
			if (!subagentsHost) return false;
			toggleSidebar("right");
		},
		settings: () => {
			if (settings) show(layout);
			else location.hash = settingsHref;
		},
		inbox: () => {
			if (inbox) return false;
			showInbox(true);
		},
		sessions: () => {
			if (!page) return false;
			show(layout);
		},
		restore: () => {
			if (!maximized) return false;
			show({ ...layout, maximized: false });
		},
	});



	let main: ReactNode;
	if (newSession) {
		const cwd = newSession.cwd ?? defaultCwd(view, state.hosts, state.past, project);
		main = (
			<NewSession
				cwd={cwd}
				launch={launch}
				connected={state.connected}
				completions={state.newSessionCompletions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
				onStart={prompt => start({ kind: "new", cwd, prompt })}
			/>
		);
	} else if (settings) {
		main = <SettingsPage cwd={settings.cwd} workspaces={workspaces(state.hosts, state.past)} />;
	} else if (inbox) {
		// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
		main = state.listed ? (
			<InboxPage
				project={project}
				hosts={state.hosts}
				past={state.past}
				target={inbox.target}
				onOpen={open}
				section={inboxTarget}
				quick={quick}
				onQuickAction={start}
				onDismissQuick={() => dismissStart("quick")}
			/>
		) : (
			<p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>
		);
	} else if (layout.panes.length > 0) {
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
						topRight={index === topRightPane && subagentsHost !== undefined}
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

	return (
		<SidebarProvider persist={false} shortcut={null} className="h-svh">
			<DashboardSidebar side="left" panel={sidebars.panels.left} onResize={width => sidebars.resize("left", width)} onToggle={() => toggleSidebar("left")}>
				<Roster
					hosts={state.hosts}
					past={state.past}
					open={page ? [] : layout.panes}
					connected={state.connected}
					newSessionOpen={newSession !== null}
					settingsHref={settingsHref}
					settingsOpen={settings !== null}
					inboxOpen={inbox !== null}
					onInboxOpen={showInbox}
					inboxTarget={inboxTarget}
					onInboxTarget={setInboxTarget}
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
					resumeAll={state.resumeAll}
					onResumeAll={resumeAll}
					onDismissResumeAll={dismissResumeAll}
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
			{subagentsHost && (
				<DashboardSidebar side="right" panel={sidebars.panels.right} onResize={width => sidebars.resize("right", width)} onToggle={() => toggleSidebar("right")}>
					<SubagentsSidebar host={subagentsHost} open={layout.panes} onOpen={open} onCancel={view => send({ t: "cancel-agent", view })} />
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
