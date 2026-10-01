import { useLayoutEffect, useRef, useState } from "react";
import type { AgentRow, GuestPhase, Item, RosterHost, View } from "../../src/shared";
import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";
import { cn } from "@/lib/utils";
import { type ToolItem, toBlocks } from "../view-model";
import { hostLabel } from "./roster";
import { statusLabel } from "./status-dot";

const PHASE_LABEL: Record<GuestPhase["phase"], string> = {
	connecting: "Connecting…",
	syncing: "Loading transcript…",
	live: "Live",
	reconnecting: "Reconnecting…",
	ended: "Disconnected",
};

const TOOL_ICON = { running: "loader", ok: "check", error: "x" } as const;

const NOTICE_TONE: Record<Extract<Item, { kind: "notice" }>["level"], string> = {
	info: "text-muted-foreground",
	warning: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
};

function ToolGroup({ tools }: { tools: ToolItem[] }) {
	const running = tools.some(tool => tool.status === "running");
	const failed = tools.filter(tool => tool.status === "error").length;
	const header = running
		? "Working"
		: `Ran ${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`;
	return (
		<ThinkingSteps defaultOpen className="w-full max-w-2xl self-start">
			<ThinkingStepsHeader>{header}</ThinkingStepsHeader>
			<ThinkingStepsContent>
				{tools.map((tool, index) => (
					<ThinkingStep
						key={tool.id}
						icon={TOOL_ICON[tool.status]}
						label={tool.name}
						description={tool.summary || undefined}
						status={tool.status === "running" ? "active" : "complete"}
						isLast={index === tools.length - 1}
					/>
				))}
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
}

interface ConversationProps {
	view: View;
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** Last known row, for the header after the session ended. */
	lastHost: RosterHost | null;
	phase: GuestPhase | undefined;
	items: Item[];
	onPrompt: (text: string) => void;
	onAbort: () => void;
}

/** One session or subagent: header, live transcript, composer. Keyed by view, so drafts and queues reset per view. */
export function Conversation({ view, host, lastHost, phase: guestPhase, items, onPrompt, onAbort }: ConversationProps) {
	const [draft, setDraft] = useState("");
	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);

	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && pinned.current) el.scrollTop = el.scrollHeight;
	}, [items]);

	const shown = host ?? lastHost;
	const agent: AgentRow | null = view.agentId ? (shown?.agents.find(a => a.id === view.agentId) ?? null) : null;
	const phase: GuestPhase = !host
		? { phase: "ended", reason: "This session is no longer running." }
		: view.agentId && !agent
			? { phase: "ended", reason: "This subagent is no longer registered." }
			: (guestPhase ?? { phase: "connecting" });

	const live = phase.phase === "live" && !phase.readOnly;
	const writable = live && (view.agentId === null || agent?.canMessage === true);
	const working = view.agentId === null ? host?.status === "working" : agent?.status === "running";
	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;

	let status = PHASE_LABEL[phase.phase];
	if (phase.phase === "live") {
		const activity = agent ? statusLabel(agent.status) : host ? statusLabel(host.status) : "";
		status = `${phase.readOnly ? "Live, read-only" : "Live"} · ${activity}`;
	}
	if (phase.phase === "ended" || phase.phase === "reconnecting") status += ` · ${phase.reason}`;

	const title = agent ? agent.id : shown ? hostLabel(shown) : view.instanceId;
	const meta = agent
		? [`${agent.kind} subagent of ${shown ? hostLabel(shown) : "a session"}`, agent.activity].filter(Boolean).join(" · ")
		: shown
			? `${shown.cwdDisplay} · ${shown.model ?? "no model"} · pid ${shown.pid}`
			: "";

	const placeholder = !writable
		? phase.phase === "live" && agent && !agent.canMessage
			? "This subagent cannot be messaged."
			: "Messaging is unavailable for this view."
		: agent
			? agent.status === "running"
				? "Steer this subagent…"
				: agent.status === "parked"
					? "Message to revive this subagent…"
					: "Message this subagent…"
			: "Message this session…";

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
				<div className="min-w-0">
					<h2 className="truncate text-sm font-semibold">{title}</h2>
					<p className="truncate text-xs text-muted-foreground">{meta}</p>
				</div>
				<span
					className={cn("shrink-0 text-xs", phase.phase === "ended" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}
					data-phase={phase.phase}
				>
					{status}
				</span>
			</header>
			<div
				ref={scrollRef}
				onScroll={event => {
					const el = event.currentTarget;
					pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
				className="min-h-0 flex-1 overflow-y-auto"
			>
				<div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6" aria-live="polite" data-transcript>
					{toBlocks(items).map(block => {
						if (block.kind === "tools") return <ToolGroup key={block.id} tools={block.tools} />;
						const item = block.item;
						switch (item.kind) {
							case "user":
								return (
									<ChatMessage key={item.id} from="user" time={item.from ?? undefined} data-item="user">
										{item.text}
									</ChatMessage>
								);
							case "assistant":
								return (
									<ChatMessage key={item.id} from="assistant" data-item="assistant" data-streaming={item.streaming}>
										{item.text}
									</ChatMessage>
								);
							case "notice":
								return (
									<p key={item.id} className={cn("self-center text-center text-xs", NOTICE_TONE[item.level])} data-item="notice">
										{item.text}
									</p>
								);
						}
					})}
					{working && !streaming && <ThinkingIndicator className="self-start" />}
				</div>
			</div>
			<div className="mx-auto w-full max-w-3xl px-6 pb-5">
				<InputMessage
					value={draft}
					onValueChange={setDraft}
					onSend={(text, _files, meta) => {
						onPrompt(text);
						// A queued message dispatching on its own must not wipe the draft being typed.
						if (!meta?.queuedId) setDraft("");
					}}
					placeholder={placeholder}
					disabled={!writable}
					// Session prompts sent mid-turn queue until the turn ends; Stop interrupts it.
					// Subagent chat steers a running turn, so it always sends at once.
					status={view.agentId === null ? (working ? "streaming" : "idle") : undefined}
					onStop={onAbort}
					queue={queue}
					onQueueChange={setQueue}
					sendLabel={agent ? "Send to subagent" : "Send to session"}
				/>
			</div>
		</div>
	);
}
