import { Maximize2, Minimize2, X } from "lucide-react";
import { memo, useCallback } from "react";
import type { RosterHost, PastSession, View, ModelOption, Delivery, MessageQueue, UserAnswer } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePane } from "../pane-store";
import type { ForkPoint } from "../transcript-view";
import type { Dashboard } from "../use-dashboard";
import { Conversation, PastConversation } from "./conversation";
import { SidebarToggle } from "./sidebar-panel";

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
	models: { models: ModelOption[]; error: string | null } | null;
	fork: Dashboard["state"]["fork"];
	resume: Dashboard["state"]["resume"];
	send: Dashboard["send"];
	forkSession: Dashboard["fork"];
	resumeSession: Dashboard["resume"];
	focus: Dashboard["focus"];
	onEnd: (instanceId: string) => void;
	onLayout: (index: number, kind: "max" | "close") => void;
	toggleRight: () => void;
	rightOpen: boolean;
}

/** A pane's cell in the 2x2 grid; the third of three spans the bottom row. */
const paneArea = (index: number, count: number): string =>
	count === 3 && index === 2 ? "2 / 1 / 3 / 3" : `${Math.floor(index / 2) + 1} / ${(index % 2) + 1}`;

/** Its own external-store subscription means another pane's token never asks this pane to render. */
export const Pane = memo(function Pane({
	view, index, count, focused, maximized, topRight, host, lastHost, session, initialDraft, models,
	fork, resume, send, forkSession, resumeSession, focus, onEnd, onLayout, toggleRight, rightOpen,
}: PaneProps) {
	const { items, completions, dequeued } = usePane(view);
	const onFork = useCallback((itemId: string, point: ForkPoint) => forkSession(view, itemId, point), [forkSession, view]);
	const onResume = useCallback(() => view.kind === "past" && resumeSession(view.sessionId), [resumeSession, view]);
	const onMaximize = useCallback(() => onLayout(index, "max"), [index, onLayout]);
	const onClose = useCallback(() => onLayout(index, "close"), [index, onLayout]);
	const onFocus = useCallback(() => !focused && focus(index), [focus, focused, index]);

	const instanceId = view.kind === "live" ? view.instanceId : null;
	const onComplete = useCallback((reqId: number, text: string, cursor: number) => {
		if (view.kind === "live") send({ t: "complete", reqId, scope: { kind: "live", view }, text, cursor });
	}, [send, view]);
	const onListModels = useCallback(() => instanceId && send({ t: "list-models", instanceId }), [send, instanceId]);
	const onSetModel = useCallback((model: ModelOption) => instanceId && send({ t: "set-model", instanceId, model }), [send, instanceId]);
	const onSetThinking = useCallback((level: string) => instanceId && send({ t: "set-thinking", instanceId, level }), [send, instanceId]);
	const onPrompt = useCallback((text: string, delivery: Delivery) => {
		if (view.kind === "live") send({ t: "prompt", view, text, delivery });
	}, [send, view]);
	const onDequeue = useCallback((reqId: number, messages: { queue: keyof MessageQueue; text: string }[]) => {
		if (view.kind === "live") send({ t: "dequeue", reqId, view, messages });
	}, [send, view]);
	const onAbort = useCallback(() => instanceId && send({ t: "abort", instanceId }), [send, instanceId]);
	const onEndSession = useCallback(() => instanceId && onEnd(instanceId), [onEnd, instanceId]);
	const onAnswer = useCallback((requestId: string, answer: UserAnswer) => instanceId && send({ t: "answer", instanceId, requestId, answer }), [send, instanceId]);

	const actions = (
		<>
			{count > 1 && (
				<>
					<Button
						variant="ghost"
						size="icon-compact"
						title={maximized ? "Restore split" : "Maximize pane"}
						aria-label={maximized ? "Restore split" : "Maximize pane"}
						onClick={onMaximize}
					>
						{maximized ? <Minimize2 /> : <Maximize2 />}
					</Button>
					<Button variant="ghost" size="icon-compact" title="Close pane" aria-label="Close pane" onClick={onClose}>
						<X />
					</Button>
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
			initialDraft={initialDraft}
			fork={fork}
			onFork={onFork}
			completions={completions}
			onComplete={onComplete}
			models={models}
			onListModels={onListModels}
			onSetModel={onSetModel}
			onSetThinking={onSetThinking}
			onPrompt={onPrompt}
			dequeued={dequeued}
			onDequeue={onDequeue}
			onAbort={onAbort}
			onEnd={onEndSession}
			onAnswer={onAnswer}
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
			{content}
		</section>
	);
});
