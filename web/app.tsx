import { Maximize2, Minimize2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { View } from "../src/shared";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, type SidebarSide } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Conversation, PastConversation, ToolsExpanded } from "./components/conversation";
import { InboxPage } from "./components/inbox-page";
import { PlanUsageFooter } from "./components/plan-usage";
import { NewSession } from "./components/new-session";
import { Roster, SPLIT_CLICK, useProject } from "./components/roster";
import { SettingsPage } from "./components/settings-page";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { SubagentsSidebar } from "./components/subagents-sidebar";
import { DashboardSidebar, SidebarToggle, useSidebarPanels } from "./components/sidebar-panel";
import { SplitResizeHandle, splitAt, storedSplitRatio } from "./components/split-resize-handle";
import { useShortcuts } from "./shortcuts";
import { EMPTY_PANE, useDashboard, useHash } from "./use-dashboard";
import {
	closePane,
	defaultCwd,
	endSession,
	type ForkPoint,
	focusedView,
	hashForSettings,
	hashForInbox,
	hashForNewSession,
	hashForView,
	inboxFromHash,
	type InboxTarget,
	newSessionFromHash,
	sameView,
	settingsFromHash,
	workspaces,
} from "./view-model";

/** A pane's cell in the 2x2 grid; the third of three spans the bottom row. */
const paneArea = (index: number, count: number): string =>
	count === 3 && index === 2 ? "2 / 1 / 3 / 3" : `${Math.floor(index / 2) + 1} / ${(index % 2) + 1}`;

/**
 * omp's Agent Hub key: into the sidebars at the open row (a session on the left, a subagent on the right),
 * and from there back to the focused pane's composer. A hidden sessions sidebar shows first.
 */
function toggleSessionsFocus(showSessions: () => void): void {
	const sidebars = [...document.querySelectorAll<HTMLElement>('[data-sidebar="sidebar"]')];
	if (sidebars.some(sidebar => sidebar.contains(document.activeElement))) {
		const pane = document.querySelector<HTMLElement>("[data-pane][data-focused]");
		(pane?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? pane)?.focus();
		return;
	}
	showSessions();
	// The kept-mounted sessions list stays in the DOM, hidden, while the Inbox tab shows; so does a hidden subagents sidebar.
	const row =
		document.querySelector<HTMLElement>('[data-sidebar="sidebar"] [data-sidebar="menu-button"][data-active]:not([hidden] *)') ??
		document.querySelector<HTMLElement>('[data-slot="sidebar"][data-side="left"] [data-sidebar="menu-button"]:not([hidden] *)');
	row?.focus();
}
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
	const { state, send, open, focus, show, openNewSession, create, fork, resume } = useDashboard();
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
	// The running sessions the sidebar lists, in its order, which ending a session moves its panes along.
	const listedHosts = state.hosts.filter(host => project === null || host.cwd === project).map(host => host.instanceId);
	const endHost = (instanceId: string): void => {
		send({ t: "end", instanceId });
		show(endSession(layout, instanceId, listedHosts));
	};
	/** The live session whose subagents the right sidebar lists. Over a past session or a page, it has none. */
	const subagentsHost = page ? undefined : viewHost;
	const toggleSidebar = (side: SidebarSide): void => sidebars.setOpen(side, !sidebars.panels[side].open);
	/** While the subagents sidebar is hidden, the button that shows it again ends the header of the pane at the top right. */
	const showSubagents = subagentsHost && !sidebars.panels.right.open && (
		<SidebarToggle side="right" open={false} onToggle={() => toggleSidebar("right")} />
	);
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);

	const settingsHref = hashForSettings(settings ? settings.cwd : (viewHost ?? viewPast)?.cwd || null);
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [inboxTarget, setInboxTarget] = useState<InboxTarget | null>(null);
	const showInbox = (open: boolean): void => {
		if (open) location.hash = hashForInbox(null);
		else show(layout);
	};
	useShortcuts({
		help: () => setShortcutsOpen(open => !open),
		tools: () => setToolsExpanded(expanded => !expanded),
		sessions: () => toggleSessionsFocus(() => sidebars.setOpen("left", true)),
		sessionsSidebar: () => toggleSidebar("left"),
		subagentsSidebar: () => {
			if (!subagentsHost) return false;
			toggleSidebar("right");
		},
		settings: () => {
			if (settings) show(layout);
			else location.hash = settingsHref;
		},
		inbox: () => showInbox(inbox === null),
		restore: () => {
			if (!maximized) return false;
			show({ ...layout, maximized: false });
		},
	});

	const paneContent = (pane: View, focused: boolean, actions: ReactNode): ReactNode => {
		const { items, completions, dequeued } = state.panes.get(hashForView(pane)) ?? EMPTY_PANE;
		const onFork = (itemId: string, point: ForkPoint) => fork(pane, itemId, point);
		if (pane.kind === "past") {
			return (
				<PastConversation
					sessionId={pane.sessionId}
					session={state.past.find(s => s.sessionId === pane.sessionId) ?? null}
					items={items}
					fork={state.fork}
					onFork={onFork}
					resume={state.resume}
					onResume={() => resume(pane.sessionId)}
					actions={actions}
				/>
			);
		}
		const { instanceId } = pane;
		return (
			<Conversation
				view={pane}
				host={state.hosts.find(h => h.instanceId === instanceId) ?? null}
				lastHost={state.lastHosts.get(instanceId) ?? null}
				items={items}
				initialDraft={state.draft && sameView(state.draft.view, pane) ? state.draft.text : ""}
				fork={state.fork}
				onFork={onFork}
				completions={completions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "live", view: pane }, text, cursor })}
				models={state.models.get(instanceId) ?? null}
				onListModels={() => send({ t: "list-models", instanceId })}
				onSetModel={model => send({ t: "set-model", instanceId, model })}
				onSetThinking={level => send({ t: "set-thinking", instanceId, level })}
				onPrompt={(text, delivery) => send({ t: "prompt", view: pane, text, delivery })}
				dequeued={dequeued}
				onDequeue={(reqId, messages) => send({ t: "dequeue", reqId, view: pane, messages })}
				onAbort={() => send({ t: "abort", instanceId })}
				onEnd={() => endHost(instanceId)}
				onAnswer={(requestId, answer) => send({ t: "answer", instanceId, requestId, answer })}
				actions={actions}
				focused={focused}
			/>
		);
	};

	let main: ReactNode;
	if (newSession) {
		const cwd = newSession.cwd ?? defaultCwd(view, state.hosts, state.past, project);
		main = (
			<NewSession
				cwd={cwd}
				workspaces={workspaces(state.hosts, state.past)}
				launch={state.launch}
				connected={state.connected}
				completions={state.newSessionCompletions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
				onPickCwd={next => (location.hash = hashForNewSession(next))}
				onStart={prompt => create(cwd, prompt)}
			/>
		);
	} else if (settings) {
		main = <SettingsPage cwd={settings.cwd} workspaces={workspaces(state.hosts, state.past)} />;
	} else if (inbox) {
		// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
		main = state.listed ? (
			<InboxPage project={project} hosts={state.hosts} past={state.past} target={inbox.target} onOpen={open} section={inboxTarget} />
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
					<section
						key={hashForView(pane)}
						tabIndex={-1}
						aria-label={`Pane ${index + 1} of ${layout.panes.length}${index === layout.focus ? ", focused" : ""}`}
						data-pane={index}
						data-focused={index === layout.focus || undefined}
						onPointerDownCapture={() => index !== layout.focus && focus(index)}
						onFocusCapture={() => index !== layout.focus && focus(index)}
						style={{ gridArea: maximized && index === layout.focus ? "1 / 1 / -1 / -1" : paneArea(index, layout.panes.length) }}
						className={cn(
							"relative flex min-h-0 min-w-0 flex-col bg-background outline-none",
							maximized && (index === layout.focus ? "z-10" : "invisible"),
						)}
					>
						{paneContent(
							pane,
							index === layout.focus,
							<>
								{split && (
									<>
										<Button
											variant="ghost"
											size="icon-compact"
											title={maximized ? "Restore split" : "Maximize pane"}
											aria-label={maximized ? "Restore split" : "Maximize pane"}
											onClick={() => show({ ...layout, focus: index, maximized: !maximized })}
										>
											{maximized ? <Minimize2 /> : <Maximize2 />}
										</Button>
										<Button variant="ghost" size="icon-compact" title="Close pane" aria-label="Close pane" onClick={() => show(closePane(layout, index))}>
											<X />
										</Button>
									</>
								)}
								{index === topRightPane && showSubagents}
							</>,
						)}
					</section>
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
					resume={state.resume}
					onResume={sessionId => {
						// The pane shows the resume's progress and failure, and the live session takes it over.
						open({ kind: "past", sessionId }, "replace");
						resume(sessionId);
					}}
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
					<SubagentsSidebar
						host={subagentsHost}
						open={layout.panes}
						onOpen={open}
						toggle={<SidebarToggle side="right" open onToggle={() => toggleSidebar("right")} />}
					/>
				</DashboardSidebar>
			)}
			<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</SidebarProvider>
	);
}
