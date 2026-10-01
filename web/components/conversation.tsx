import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { AgentRow, CompletionItem, ControlPhase, Item, LiveView, ModelOption, PastSession, RosterHost } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScroller,
} from "@/components/ui/message-scroller";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { Fork } from "../use-dashboard";
import { type ForkPoint, forkPoints, modelName, modelOrg, type ToolItem, toBlocks } from "../view-model";
import { completionTrigger } from "../completion-trigger";
import { CompletionPopup } from "./completion-popup";
import { MessageMarkdown } from "./message-markdown";
import { ModelPicker } from "./model-picker";
import { OrgIcon } from "./org-icon";
import { hostLabel, pastLabel, projectName } from "./roster";
import { statusLabel } from "./status-dot";

const CONTROL_LABEL: Record<ControlPhase["phase"], string> = {
	connecting: "Connecting…",
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
	// Open while running, closed once done; a manual toggle wins from then on.
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const header = running
		? "Working"
		: `Ran ${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`;
	return (
		<ThinkingSteps open={userOpen ?? running} onOpenChange={setUserOpen} className="w-full max-w-2xl self-start">
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

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	const Icon = copied ? CheckIcon : CopyIcon;
	return (
		<Button
			variant="ghost"
			size="icon-compact"
			aria-label={copied ? "Copied" : "Copy message"}
			title={copied ? "Copied" : "Copy message"}
			data-copied={copied || undefined}
			onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
		>
			<Icon />
		</Button>
	);
}

function ForkButton({ point, forking, disabled, onFork }: { point: ForkPoint; forking: boolean; disabled: boolean; onFork: () => void }) {
	const BranchIcon = useIcon("git-branch");
	const LoaderIcon = useIcon("loader");
	const title = forking
		? "Forking…"
		: point.prefill
			? "Fork from here: a new session with the history before this prompt, ready to edit and resend it"
			: "Fork from here: a new session with the history through this reply";
	return (
		<Button
			variant="ghost"
			size="icon-compact"
			aria-label={forking ? "Forking" : "Fork from here"}
			title={title}
			aria-busy={forking || undefined}
			disabled={disabled}
			data-fork={point.prefill ? "prompt" : "reply"}
			onClick={onFork}
		>
			{forking ? <LoaderIcon className="animate-spin" /> : <BranchIcon />}
		</Button>
	);
}

interface TranscriptProps {
	items: Item[];
	working: boolean;
	fork: Fork;
	onFork: (itemId: string, point: ForkPoint) => void;
}

interface HeaderProps {
	title: string;
	meta: ReactNode;
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

/** The project a session runs in, with its full directory on hover. */
const Project = ({ cwdDisplay }: { cwdDisplay: string }) => <span title={cwdDisplay}>{projectName(cwdDisplay) ?? cwdDisplay}</span>;

/** `anthropic/claude-opus-5-5` as the Anthropic logo and `opus-5-5`, with the full selector on hover. */
function Model({ selector }: { selector: string }) {
	return (
		<span title={selector}>
			<OrgIcon org={modelOrg(selector)} label className="mr-1 inline-block align-[-0.125em]" />
			{modelName(selector)}
		</span>
	);
}

/** The scrolling message list. It follows new output until the reader scrolls up; the button jumps back to the end. */
function Transcript({ items, working, fork, onFork }: TranscriptProps) {
	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;
	const forks = forkPoints(items);

	return (
		<MessageScroller className="flex-1">
			<MessageScrollerViewport>
				<MessageScrollerContent className="mx-auto max-w-3xl gap-3 px-6 py-6" aria-relevant="additions text" data-transcript>
					{toBlocks(items).map(block => {
						if (block.kind === "tools") {
							return (
								<MessageScrollerItem key={block.id} messageId={block.id} className="flex flex-col">
									<ToolGroup tools={block.tools} />
								</MessageScrollerItem>
							);
						}
						const item = block.item;
						if (item.kind === "notice") {
							return (
								<MessageScrollerItem key={item.id} messageId={item.id} className="flex flex-col">
									<p className={cn("self-center text-center text-xs", NOTICE_TONE[item.level])} data-item="notice">
										{item.text}
									</p>
								</MessageScrollerItem>
							);
						}
						const copyable = !(item.kind === "assistant" && item.streaming) && item.text.trim() !== "";
						const point = forks.get(item.id);
						const failed = fork.phase === "failed" && fork.itemId === item.id ? fork.error : null;
						return (
							<MessageScrollerItem key={item.id} messageId={item.id} className="flex flex-col">
								<ChatMessage
									from={item.kind}
									time={item.kind === "user" ? (item.from ?? undefined) : undefined}
									actions={
										copyable || point ? (
											<>
												{copyable && <CopyButton text={item.text} />}
												{point && (
													<ForkButton
														point={point}
														forking={fork.phase === "forking" && fork.itemId === item.id}
														disabled={fork.phase === "forking"}
														onFork={() => onFork(item.id, point)}
													/>
												)}
											</>
										) : undefined
									}
									data-item={item.kind}
									data-streaming={item.kind === "assistant" ? item.streaming : undefined}
								>
									<MessageMarkdown text={item.text} />
								</ChatMessage>
								{failed && (
									<p role="alert" className={cn(item.kind === "user" ? "self-end" : "self-start", "text-xs", NOTICE_TONE.error)}>
										{failed}
									</p>
								)}
							</MessageScrollerItem>
						);
					})}
					{working && !streaming && (
						<MessageScrollerItem messageId="thinking" className="flex flex-col">
							<ThinkingIndicator className="self-start" />
						</MessageScrollerItem>
					)}
				</MessageScrollerContent>
			</MessageScrollerViewport>
			<MessageScrollerButton />
		</MessageScroller>
	);
}

interface PastConversationProps {
	sessionId: string;
	/** The listed row, or `null` when the session is no longer listed. */
	session: PastSession | null;
	items: Item[];
	fork: Fork;
	onFork: (itemId: string, point: ForkPoint) => void;
}

/** A past session's saved transcript. It follows the file, but nothing on this page can write to it. */
export function PastConversation({ sessionId, session, items, fork, onFork }: PastConversationProps) {
	const meta = session ? (
		<>
			<Project cwdDisplay={session.cwdDisplay} /> · last active {new Date(session.modifiedAt).toLocaleString()}
		</>
	) : (
		sessionId
	);
	return (
		<MessageScrollerProvider autoScroll>
			<div className="flex h-svh min-h-0 flex-1 flex-col">
				<Header title={session ? pastLabel(session) : "Past session"} meta={meta} status="Read-only" alert={false} />
				<Transcript items={items} working={false} fork={fork} onFork={onFork} />
			</div>
		</MessageScrollerProvider>
	);
}

interface ConversationProps {
	view: LiveView;
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** Last known row, for the header after the session ended. */
	lastHost: RosterHost | null;
	items: Item[];
	/** Composer text on mount, from a fork. */
	initialDraft: string;
	fork: Fork;
	onFork: (itemId: string, point: ForkPoint) => void;
	completions: { reqId: number; items: CompletionItem[]; error: string | null } | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** The last model list the server sent for this session, or `null` while none has arrived. */
	models: { models: ModelOption[]; error: string | null } | null;
	onListModels: () => void;
	onSetModel: (model: ModelOption) => void;
	onPrompt: (text: string) => void;
	onAbort: () => void;
	onEnd: () => void;
}

/** One live session or subagent: header, live transcript, composer. Keyed by view, so drafts, queues, and scroll reset per view. */
export function Conversation(props: ConversationProps) {
	return (
		<MessageScrollerProvider autoScroll>
			<LiveConversation {...props} />
		</MessageScrollerProvider>
	);
}

function LiveConversation({
	view,
	host,
	lastHost,
	items,
	initialDraft,
	fork,
	onFork,
	completions,
	onComplete,
	models,
	onListModels,
	onSetModel,
	onPrompt,
	onAbort,
	onEnd,
}: ConversationProps) {
	const { scrollToEnd } = useMessageScroller();
	const [draft, setDraft] = useState(initialDraft);
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
	const phase: ControlPhase = !host
		? { phase: "ended", reason: "This session is no longer running." }
		: view.agentId && !agent
			? { phase: "ended", reason: "This subagent is no longer registered." }
			: host.control;

	const live = phase.phase === "live" && !phase.readOnly;
	const writable = live && (view.agentId === null || agent?.canMessage === true);
	const working = view.agentId === null ? host?.status === "working" : agent?.status === "running";

	let status = CONTROL_LABEL[phase.phase];
	if (phase.phase === "live") {
		const activity = agent ? statusLabel(agent.status) : host ? statusLabel(host.status) : "";
		status = `${phase.readOnly ? "Live, read-only" : "Live"} · ${activity}`;
	}
	if (phase.phase === "ended" || phase.phase === "reconnecting") status += ` · ${phase.reason}`;

	const title = agent ? agent.id : shown ? hostLabel(shown) : view.instanceId;
	const meta = agent
		? [`${agent.kind} subagent of ${shown ? hostLabel(shown) : "a session"}`, agent.activity].filter(Boolean).join(" · ")
		: shown && (
				<>
					<Project cwdDisplay={shown.cwdDisplay} /> · {shown.model ? <Model selector={shown.model} /> : "no model"} · pid {shown.pid}
				</>
			);

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
	const shownModel = shown?.model ?? null;
	// Collab rooms carry no model switch, so only sessions this dashboard started over RPC can change it.
	const modelSlot =
		view.agentId !== null ? null : host?.source === "dashboard" && live ? (
			<ModelPicker current={shownModel} list={models} onOpen={onListModels} onPick={onSetModel} />
		) : shownModel ? (
			<span className="truncate px-2 text-xs text-muted-foreground" title="Switch this session's model from its omp terminal.">
				{shownModel.slice(shownModel.indexOf("/") + 1)}
			</span>
		) : null;
	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta} status={status} alert={phase.phase === "ended"}>
				{view.agentId === null && host?.source === "dashboard" && (
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
			<Transcript items={items} working={working === true} fork={fork} onFork={onFork} />
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
						if (!meta?.queuedId) {
							setDraft("");
							scrollToEnd();
						}
					}}
					leftSlot={modelSlot}
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
