import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import type { AgentRow, CompletionItem, GuestPhase, Item, LiveView, PastSession, RosterHost } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";
import { cn } from "@/lib/utils";
import { type ToolItem, toBlocks } from "../view-model";
import { completionTrigger } from "../completion-trigger";
import { CompletionPopup } from "./completion-popup";
import { MessageMarkdown } from "./message-markdown";
import { hostLabel, pastLabel } from "./roster";
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

interface HeaderProps {
	title: string;
	meta: string;
	status: string;
	alert: boolean;
	children?: ReactNode;
}

function Header({ title, meta, status, alert, children }: HeaderProps) {
	return (
		<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
			<div className="min-w-0">
				<h2 className="truncate text-sm font-semibold">{title}</h2>
				<p className="truncate text-xs text-muted-foreground">{meta}</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				<span className={cn("text-xs", alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} data-status>
					{status}
				</span>
				{children}
			</div>
		</header>
	);
}

/** The scrolling message list. It stays pinned to the bottom unless the reader scrolled up. */
function Transcript({ items, working }: { items: Item[]; working: boolean }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);

	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && pinned.current) el.scrollTop = el.scrollHeight;
	}, [items]);

	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;

	return (
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
									<MessageMarkdown text={item.text} />
								</ChatMessage>
							);
						case "assistant":
							return (
								<ChatMessage key={item.id} from="assistant" data-item="assistant" data-streaming={item.streaming}>
									<MessageMarkdown text={item.text} />
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
	);
}

interface PastConversationProps {
	sessionId: string;
	/** The listed row, or `null` when the session is no longer listed. */
	session: PastSession | null;
	items: Item[];
}

/** A past session's saved transcript. Nothing on this page can write to it. */
export function PastConversation({ sessionId, session, items }: PastConversationProps) {
	const meta = session ? `${session.cwdDisplay} · last active ${new Date(session.modifiedAt).toLocaleString()}` : sessionId;
	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title={session ? pastLabel(session) : "Past session"} meta={meta} status="Ended · read-only" alert={false} />
			<Transcript items={items} working={false} />
		</div>
	);
}

interface ConversationProps {
	view: LiveView;
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** Last known row, for the header after the session ended. */
	lastHost: RosterHost | null;
	phase: GuestPhase | undefined;
	items: Item[];
	completions: { reqId: number; items: CompletionItem[]; error: string | null } | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	onPrompt: (text: string) => void;
	onAbort: () => void;
	onEnd: () => void;
}

/** One live session or subagent: header, live transcript, composer. Keyed by view, so drafts and queues reset per view. */
export function Conversation({ view, host, lastHost, phase: guestPhase, items, completions, onComplete, onPrompt, onAbort, onEnd }: ConversationProps) {
	const [draft, setDraft] = useState("");
	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const [requestId, setRequestId] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const nextId = useRef(0);
	const composerRef = useRef<HTMLDivElement>(null);
	const popupId = useId();

	const suggestions = requestId !== null && completions?.reqId === requestId ? completions.items : [];
	const popupOpen = requestId !== null;
	const suggest = (text: string, cursor: number): void => {
		if (!completionTrigger(text, cursor)) {
			setRequestId(null);
			return;
		}
		const id = ++nextId.current;
		setRequestId(id);
		setActive(0);
		onComplete(id, text, cursor);
	};
	const pick = (item: CompletionItem): void => {
		setDraft(item.text);
		setRequestId(null);
		requestAnimationFrame(() => {
			const el = composerRef.current?.querySelector("textarea");
			el?.focus();
			el?.setSelectionRange(item.cursor, item.cursor);
		});
	};

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

	const directCommand = draft.startsWith("$") ? "Python" : draft.startsWith("!") ? "shell" : null;
	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta} status={status} alert={phase.phase === "ended"}>
				{view.agentId === null && host?.owned && (
					<Button
						variant="secondary"
						size="compact"
						onClick={onEnd}
						title="Stop the omp process this dashboard started. Its transcript moves to Past sessions."
					>
						End session
					</Button>
				)}
			</Header>
			<Transcript items={items} working={working === true} />
			<div className="relative mx-auto w-full max-w-3xl px-6 pb-5">
				{popupOpen && (
					<CompletionPopup id={popupId} items={suggestions} active={Math.min(active, suggestions.length - 1)}
						error={completions?.reqId === requestId ? completions.error : null} onPick={pick} />
				)}
				<InputMessage
					ref={composerRef}
					value={draft}
					onValueChange={text => {
						setDraft(text);
						suggest(text, composerRef.current?.querySelector("textarea")?.selectionStart ?? text.length);
					}}
					textareaProps={{
						"aria-controls": popupOpen ? popupId : undefined,
						"aria-expanded": popupOpen,
						"aria-autocomplete": "list",
						"aria-activedescendant": popupOpen && suggestions.length ? `${popupId}-${Math.min(active, suggestions.length - 1)}` : undefined,
						onClick: event => suggest(draft, event.currentTarget.selectionStart),
						onKeyUp: event => {
							if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
								suggest(draft, event.currentTarget.selectionStart);
							}
						},
						onKeyDown: event => {
							if (!popupOpen || event.nativeEvent.isComposing) return;
							if (event.key === "Escape") {
								event.preventDefault();
								setRequestId(null);
							} else if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
								event.preventDefault();
								setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
							} else if (suggestions.length && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
								event.preventDefault();
								pick(suggestions[Math.min(active, suggestions.length - 1)]);
							}
						},
					}}
					onSend={(text, _files, meta) => {
						if (directCommand) return;
						onPrompt(text);
						setRequestId(null);
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
				{directCommand && (
					<p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
						Direct {directCommand} execution needs the omp terminal. Collab cannot run it in this session.
					</p>
				)}
			</div>
		</div>
	);
}
