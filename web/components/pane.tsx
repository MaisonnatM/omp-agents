import { Maximize2, Minimize2, Route, X } from "lucide-react";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import type { LiveView, PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import type { ModelList } from "../reads";
import { hashForView } from "../routing";
import { shortcutLabels } from "../shortcuts";
import type { ForkPoint } from "../transcript-view";
import { Conversation } from "./conversation";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
import { HeaderControlsContext, useHeaderControls } from "./header-controls";
import { PastConversation } from "./past-conversation";
import { RenderBoundary } from "./render-boundary";
import { ReplayCompareDialog } from "./replay-compare";
import { SidebarToggle } from "./sidebar-panel";
import { SubagentLinks } from "./transcript";

interface PaneProps {
	view: View;
	index: number;
	count: number;
	focused: boolean;
	maximized: boolean;
	/** The pane in the grid's top right corner, which ends its header with the command menu and the bell. */
	topRight: boolean;
	/** The right sidebar shows the focused session's details, so the top right pane carries its toggle. */
	hasDetails: boolean;
	host: RosterHost | null;
	lastHost: RosterHost | null;
	session: PastSession | null;
	models: ModelList;
	/** The workspaces, which the composer's directory picker offers. */
	workspaces: Workspace[];
	onLayout: (index: number, kind: "max" | "close") => void;
	toggleRight: () => void;
	rightOpen: boolean;
}

/** A pane's cell in the 2x2 grid; the third of three spans the bottom row. */
const paneArea = (index: number, count: number): string =>
	count === 3 && index === 2 ? "2 / 1 / 3 / 3" : `${Math.floor(index / 2) + 1} / ${(index % 2) + 1}`;

interface ViewConversationProps {
	view: View;
	focused: boolean;
	host: RosterHost | null;
	lastHost: RosterHost | null;
	session: PastSession | null;
	models: ModelList;
	/** The workspaces, which the composer's directory picker offers. */
	workspaces: Workspace[];
	/** Header controls after the conversation's own, such as a split pane's maximize and close. */
	actions?: ReactNode;
	/** Draw the conversation's own header, with a past session's Resume; a Bot's page draws its own and resumes from its composer. */
	header: boolean;
	/** The composer's placeholder while the session waits on a message. */
	placeholder?: string;
}

/**
 * A view's conversation, live or past, with its trajectory switch, its replay comparison, and what its transcript reads
 * from around it. It reads none of its view's data, which `Conversation` and `Transcript` read by field, so a streamed
 * token never asks it to render.
 */
export const ViewConversation = memo(function ViewConversation({ view, focused, host, lastHost, session, models, workspaces, actions, header, placeholder }: ViewConversationProps) {
	const { send, request, start, open, end } = useDashboardActions();
	const { fork, resume } = useDashboardStatus().starts;
	const instanceId = view.kind === "live" ? view.instanceId : null;
	const agents = host?.agents;
	const writable = host?.control.phase === "live" && !host.control.readOnly;
	const links = useMemo(
		() =>
			instanceId
				? { instanceId, agents: agents ?? [], onOpen: open, onCancel: writable ? (agent: LiveView & { agentId: string }) => request({ t: "cancel-agent", view: agent }) : null }
				: null,
		[instanceId, agents, open, writable, request],
	);
	const onFork = useCallback((itemId: string, point: ForkPoint) => start({ kind: "fork", view, itemId, point }), [start, view]);
	const onResume = useCallback(() => view.kind === "past" && start({ kind: "resume", sessionId: view.sessionId }), [start, view]);
	// Kept by view, so a pane that switches to another session shows its transcript.
	const [trajectoryOf, setTrajectoryOf] = useState<string | null>(null);
	const trajectory = trajectoryOf === hashForView(view);
	const replay = view.kind === "past" ? session?.replay : view.agentId === null ? (host ?? lastHost)?.replay : undefined;
	const [compareOf, setCompareOf] = useState<string | null>(null);

	const trajectoryToggle = (
		<Tooltip content={trajectory ? "Show the transcript" : "Show the trajectory: each turn's injected context, model requests, tool calls, and token usage"} side="bottom">
			<Button
				{...activityControl("trajectory.toggle")}
				variant="ghost"
				size="icon-compact"
				aria-label="Trajectory"
				aria-pressed={trajectory}
				className={cn(trajectory && "bg-muted text-foreground")}
				onClick={() => setTrajectoryOf(trajectory ? null : hashForView(view))}
			>
				<Route />
			</Button>
		</Tooltip>
	);
	const headerActions = (
		<>
			{replay && <Button {...activityControl("replay-compare.open")} size="compact" variant="ghost" onClick={() => setCompareOf(hashForView(view))}>Compare replay</Button>}
			{actions}
		</>
	);
	const content = view.kind === "past" ? (
		<PastConversation
			sessionId={view.sessionId}
			session={session}
			fork={fork}
			onFork={onFork}
			resume={resume}
			onResume={onResume}
			actions={headerActions}
			titleAction={trajectoryToggle}
			trajectory={trajectory}
			header={header}
		/>
	) : (
		<Conversation
			view={view}
			host={host}
			lastHost={lastHost}
			fork={fork}
			onFork={onFork}
			models={models}
			send={send}
			onEnd={end}
			actions={headerActions}
			titleAction={trajectoryToggle}
			trajectory={trajectory}
			focused={focused}
			workspaces={workspaces}
			header={header}
			placeholder={placeholder}
		/>
	);

	return (
		<HeaderControlsContext.Provider value={null}>
			<SubagentLinks.Provider value={links}>
				<FileBaseContext.Provider value={fileBase(view.kind === "past" ? session : (host ?? lastHost))}>
					<RenderBoundary resetKey={hashForView(view)} actions={headerActions}>
						{content}
						{replay && compareOf === hashForView(view) && <ReplayCompareDialog view={view} facts={replay} onClose={() => setCompareOf(null)} />}
					</RenderBoundary>
				</FileBaseContext.Provider>
			</SubagentLinks.Provider>
		</HeaderControlsContext.Provider>
	);
});

/** A pane's cell in the grid: its view's conversation, with the grid's controls in its header. */
export const Pane = memo(function Pane({
	view, index, count, focused, maximized, topRight, hasDetails, host, lastHost, session, models, workspaces, onLayout, toggleRight, rightOpen,
}: PaneProps) {
	const { focus } = useDashboardActions();
	const controls = useHeaderControls();
	const onMaximize = useCallback(() => onLayout(index, "max"), [index, onLayout]);
	const onClose = useCallback(() => onLayout(index, "close"), [index, onLayout]);
	const onFocus = useCallback(() => !focused && focus(index), [focus, focused, index]);
	const actions = (
		<>
			{count > 1 && (
				<>
					<Tooltip content={maximized ? "Restore split" : "Maximize pane"} shortcut={maximized ? shortcutLabels("restore") : undefined} side="bottom">
						<Button variant="ghost" size="icon-compact" aria-label={maximized ? "Restore split" : "Maximize pane"} onClick={onMaximize}>
							{maximized ? <Minimize2 /> : <Maximize2 />}
						</Button>
					</Tooltip>
					<Tooltip content="Close pane" side="bottom">
						<Button variant="ghost" size="icon-compact" aria-label="Close pane" onClick={onClose}>
							<X />
						</Button>
					</Tooltip>
				</>
			)}
			{topRight && controls}
			{topRight && hasDetails && <SidebarToggle side="right" open={rightOpen} onToggle={toggleRight} />}
		</>
	);

	return (
		<section
			tabIndex={-1}
			aria-label={`Pane ${index + 1} of ${count}${focused ? ", focused" : ""}`}
			data-pane={index}
			data-focused={focused || undefined}
			onPointerDownCapture={onFocus}
			onFocusCapture={onFocus}
			style={{ gridArea: maximized && focused ? "1 / 1 / -1 / -1" : paneArea(index, count) }}
			className={cn("relative flex min-h-0 min-w-0 flex-col bg-background outline-none", maximized && (focused ? "z-10" : "invisible"))}
		>
			<ViewConversation view={view} focused={focused} host={host} lastHost={lastHost} session={session} models={models} workspaces={workspaces} actions={actions} header />
		</section>
	);
});

/** Where the agent's relative paths start: the linked worktree it works in, else its directory. */
const fileBase = (session: { cwd: string; worktree: string | null } | null | undefined): string | null => session?.worktree ?? session?.cwd ?? null;
