import { Maximize2, Minimize2, X } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { LiveView, PastSession, RosterHost, View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePane } from "../pane-store";
import type { ModelList } from "../reads";
import { shortcutLabels } from "../shortcuts";
import type { ForkPoint } from "../transcript-view";
import { Conversation } from "./conversation";
import { useDashboardContext } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
import { PastConversation } from "./past-conversation";
import { SidebarToggle } from "./sidebar-panel";
import { SubagentLinks } from "./transcript";

interface PaneProps {
	view: View;
	index: number;
	count: number;
	focused: boolean;
	maximized: boolean;
	topRight: boolean;
	host: RosterHost | null;
	lastHost: RosterHost | null;
	session: PastSession | null;
	initialDraft: string;
	models: ModelList;
	onLayout: (index: number, kind: "max" | "close") => void;
	toggleRight: () => void;
	rightOpen: boolean;
}

/** A pane's cell in the 2x2 grid; the third of three spans the bottom row. */
const paneArea = (index: number, count: number): string =>
	count === 3 && index === 2 ? "2 / 1 / 3 / 3" : `${Math.floor(index / 2) + 1} / ${(index % 2) + 1}`;

/** Its own external-store subscription means another pane's token never asks this pane to render. */
export const Pane = memo(function Pane({
	view, index, count, focused, maximized, topRight, host, lastHost, session, initialDraft, models, onLayout, toggleRight, rightOpen,
}: PaneProps) {
	const { send, start, focus, open, end, starts: { fork, resume } } = useDashboardContext();
	const { items, loaded, completions, dequeued } = usePane(view);
	const instanceId = view.kind === "live" ? view.instanceId : null;
	const agents = host?.agents;
	const writable = host?.control.phase === "live" && !host.control.readOnly;
	const links = useMemo(
		() =>
			instanceId
				? { instanceId, agents: agents ?? [], onOpen: open, onCancel: writable ? (agent: LiveView & { agentId: string }) => send({ t: "cancel-agent", view: agent }) : null }
				: null,
		[instanceId, agents, open, writable, send],
	);
	const onFork = useCallback((itemId: string, point: ForkPoint) => start({ kind: "fork", view, itemId, point }), [start, view]);
	const onResume = useCallback(() => view.kind === "past" && start({ kind: "resume", sessionId: view.sessionId }), [start, view]);
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
			{topRight && <SidebarToggle side="right" open={rightOpen} onToggle={toggleRight} />}
		</>
	);
	const content = view.kind === "past" ? (
		<PastConversation sessionId={view.sessionId} session={session} items={items} fork={fork} onFork={onFork} resume={resume} onResume={onResume} actions={actions} />
	) : (
		<Conversation
			view={view}
			host={host}
			lastHost={lastHost}
			items={items}
			loaded={loaded}
			initialDraft={initialDraft}
			fork={fork}
			onFork={onFork}
			completions={completions}
			models={models}
			dequeued={dequeued}
			send={send}
			onEnd={end}
			actions={actions}
			focused={focused}
		/>
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
			<SubagentLinks.Provider value={links}>
				<FileBaseContext.Provider value={(view.kind === "past" ? session : (host ?? lastHost))?.cwd ?? null}>{content}</FileBaseContext.Provider>
			</SubagentLinks.Provider>
		</section>
	);
});
