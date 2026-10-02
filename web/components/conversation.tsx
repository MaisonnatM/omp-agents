import { ArrowUpRight, Brain, ListEnd, Sparkles } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type {
	AgentRow,
	ControlPhase,
	Delivery,
	Item,
	LinkedPullRequest,
	LiveView,
	MessageQueue,
	ModelOption,
	PastSession,
	RosterHost,
	UserAnswer,
	View,
} from "../../src/shared";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage } from "@/components/ui/input-message";
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
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { Completions, Fork, Resume } from "../use-dashboard";
import { type ForkPoint, forkPoints, graphiteUrl, hashForInbox, pullRequestUrl, sameView, skillLabel, type ToolItem, toBlocks } from "../view-model";
import { chordLabel, SHORTCUTS, useShortcuts } from "../shortcuts";
import { useCompletion } from "./completion-popup";
import { ContextRing } from "./context-ring";
import { MessageMarkdown } from "./message-markdown";
import { Model, ModelPicker } from "./model-picker";
import { OrgIcon } from "./org-icon";
import { hostLabel, pastLabel, projectName } from "./roster";
import { statusLabel } from "./status-dot";
import { ThinkingPicker } from "./thinking-picker";
import { UserRequestCard } from "./user-request";

const CONTROL_LABEL: Record<ControlPhase["phase"], string> = {
	connecting: "Connecting…",
	live: "Live",
	reconnecting: "Reconnecting…",
	ended: "Disconnected",
};

const TOOL_ICON = { running: "loader", ok: "check", error: "x" } as const;

/** omp's queues, in the order its Alt+↑ takes them back, with the tag each queued row shows. */
const QUEUE_TAGS: [keyof MessageQueue, string][] = [
	["steering", "Steer"],
	["followUp", "Follow-up"],
];

const FOLLOW_UP_KEYS = SHORTCUTS.filter(({ id }) => id === "followUp")
	.map(({ chord }) => chordLabel(chord))
	.join(" or ");

const NOTICE_TONE: Record<Extract<Item, { kind: "notice" }>["level"], string> = {
	info: "text-muted-foreground",
	warning: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
};

/** Whether finished tool groups show their steps. The tools shortcut flips it for every pane. */
export const ToolsExpanded = createContext(false);

function ToolGroup({ tools }: { tools: ToolItem[] }) {
	const expanded = useContext(ToolsExpanded);
	const running = tools.some(tool => tool.status === "running");
	const failed = tools.filter(tool => tool.status === "error").length;
	// Open while running, else as `expanded` says; a manual toggle wins until `expanded` flips.
	const [toggle, setToggle] = useState<{ open: boolean; expanded: boolean } | null>(null);
	const open = toggle?.expanded === expanded ? toggle.open : running || expanded;
	const header = running
		? "Working"
		: `Ran ${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`;
	return (
		<ThinkingSteps open={open} onOpenChange={next => setToggle({ open: next, expanded })} className="w-full max-w-2xl self-start">
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
	view: View;
	items: Item[];
	working: boolean;
	fork: Fork;
	onFork: (itemId: string, point: ForkPoint) => void;
}

interface HeaderProps {
	title: string;
	meta: ReactNode;
	status?: string;
	alert?: boolean;
	children?: ReactNode;
}

export function Header({ title, meta, status, alert = false, children }: HeaderProps) {
	return (
		<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
			<div className="min-w-0">
				<h2 className="truncate text-sm font-semibold">{title}</h2>
				<p className="truncate text-xs text-muted-foreground">{meta}</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{status !== undefined && (
					<span className={cn("text-xs", alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} data-status>
						{status}
					</span>
				)}
				{children}
			</div>
		</header>
	);
}

/** The project a session runs in, with its full directory on hover. */
const Project = ({ cwdDisplay }: { cwdDisplay: string }) => <span title={cwdDisplay}>{projectName(cwdDisplay) ?? cwdDisplay}</span>;

/** The omp terminal shortcut a draft starts with, which the dashboard cannot run: `$` Python or `!` shell. */
export const directCommandOf = (draft: string): "Python" | "shell" | null =>
	draft.startsWith("$") ? "Python" : draft.startsWith("!") ? "shell" : null;

export const DirectCommandNote = ({ kind }: { kind: "Python" | "shell" }) => (
	<p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
		Direct {kind} execution needs the omp terminal. Collab cannot run it in this session.
	</p>
);

/** The skill a prompt invoked, as a pill ahead of the user's words. */
function SkillBadge({ name }: { name: string }) {
	return (
		<span
			title={`/skill:${name}`}
			className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border"
			data-skill={name}
		>
			<Sparkles aria-hidden className="size-3 text-violet-500 dark:text-violet-400" />
			<span className="sr-only">Skill:</span>
			{skillLabel(name)}
		</span>
	);
}

/** What a prompt's copy button copies: a skill prompt as the user typed it, not the skill's text. */
const typedText = (item: Exclude<Item, ToolItem>): string =>
	item.kind === "user" && item.skill ? [`/skill:${item.skill}`, item.text].filter(Boolean).join(" ") : item.text;

/**
 * The PRs a session submitted or worked on, after a separator. The number opens the PR's details in the inbox, the
 * arrow after it opens the PR on GitHub, and the Graphite mark opens it on Graphite.
 */
function PullRequests({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
	return pullRequests.map(pr => {
		const name = `${pr.owner}/${pr.repo}#${pr.number}`;
		return (
			<Fragment key={name}>
				{" · "}
				<a
					href={hashForInbox(pr)}
					title={`${name}, which this session ${pr.link === "submitted" ? "submitted" : "worked on"}, in the inbox`}
					className="underline-offset-2 hover:text-foreground hover:underline"
				>
					#{pr.number}
				</a>
				<a
					href={pullRequestUrl(pr)}
					target="_blank"
					rel="noreferrer"
					title={`${name} on GitHub`}
					aria-label={`${name} on GitHub`}
					className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ArrowUpRight aria-hidden className="inline size-3 align-[-0.125em]" />
				</a>
				<a
					href={graphiteUrl(pr)}
					target="_blank"
					rel="noreferrer"
					title={`${name} on Graphite`}
					aria-label={`${name} on Graphite`}
					className="ml-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<OrgIcon org="graphite" className="inline align-[-0.125em]" />
				</a>
			</Fragment>
		);
	});
}

/** The scrolling message list. It follows new output until the reader scrolls up; the button jumps back to the end. */
function Transcript({ view, items, working, fork, onFork }: TranscriptProps) {
	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;
	const forks = forkPoints(items);
	// Item ids repeat across views (a fork keeps its source's history), so the fork's own view must match.
	const here = fork.phase !== "idle" && sameView(fork.view, view) ? fork : null;

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
						const copyable = !(item.kind === "assistant" && item.streaming) && typedText(item).trim() !== "";
						const point = forks.get(item.id);
						const failed = here?.phase === "failed" && here.itemId === item.id ? here.error : null;
						return (
							<MessageScrollerItem key={item.id} messageId={item.id} className="flex flex-col">
								<ChatMessage
									from={item.kind}
									time={item.kind === "user" ? (item.from ?? undefined) : undefined}
									actions={
										copyable || point ? (
											<>
												{copyable && <CopyButton text={typedText(item)} />}
												{point && (
													<ForkButton
														point={point}
														forking={here?.phase === "forking" && here.itemId === item.id}
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
									{item.kind === "user" && item.skill ? (
										<div className="flex flex-col items-start gap-1.5">
											<SkillBadge name={item.skill} />
											{item.text && <MessageMarkdown text={item.text} />}
										</div>
									) : (
										<MessageMarkdown text={item.text} />
									)}
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
	resume: Resume;
	onResume: () => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
}

/** A past session's saved transcript. It follows the file; **Resume** continues it in a session this dashboard starts. */
export function PastConversation({ sessionId, session, items, fork, onFork, resume, onResume, actions }: PastConversationProps) {
	const meta = session ? (
		<>
			<Project cwdDisplay={session.cwdDisplay} /> · last active {new Date(session.modifiedAt).toLocaleString()}
			<PullRequests pullRequests={session.pullRequests} />
		</>
	) : (
		sessionId
	);
	const resuming = resume.phase === "resuming" && resume.sessionId === sessionId;
	const failed = resume.phase === "failed" && resume.sessionId === sessionId ? resume.error : null;
	return (
		<MessageScrollerProvider autoScroll>
			<div className="flex h-full min-h-0 flex-1 flex-col">
				<Header title={session ? pastLabel(session) : "Past session"} meta={meta} status="Read-only" alert={false}>
					{session && (
						<Button
							variant="secondary"
							size="compact"
							onClick={onResume}
							disabled={resume.phase === "resuming"}
							aria-busy={resuming || undefined}
							title="Start omp on this session's file from this dashboard, as omp --resume does, and continue it here."
						>
							{resuming ? "Resuming…" : "Resume"}
						</Button>
					)}
					{actions}
				</Header>
				{failed && (
					<p role="alert" className={cn("border-b border-border px-6 py-2 text-xs", NOTICE_TONE.error)}>
						{failed}
					</p>
				)}
				<Transcript view={{ kind: "past", sessionId }} items={items} working={false} fork={fork} onFork={onFork} />
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
	completions: Completions | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** The last model list the server sent for this session, or `null` while none has arrived. */
	models: { models: ModelOption[]; error: string | null } | null;
	onListModels: () => void;
	onSetModel: (model: ModelOption) => void;
	onSetThinking: (level: string) => void;
	onPrompt: (text: string, delivery: Delivery) => void;
	/** The server's last answer to this view's `dequeue`. */
	dequeued: { reqId: number; texts: string[] } | null;
	onDequeue: (reqId: number, messages: { queue: keyof MessageQueue; text: string }[]) => void;
	onAbort: () => void;
	onEnd: () => void;
	onAnswer: (requestId: string, answer: UserAnswer) => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
	/** Whether this is the focused pane, the one session shortcuts act on. */
	focused: boolean;
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
	onSetThinking,
	onPrompt,
	dequeued,
	onDequeue,
	onAbort,
	onEnd,
	onAnswer,
	actions,
	focused,
}: ConversationProps) {
	const { scrollToEnd } = useMessageScroller();
	const [draft, setDraft] = useState(initialDraft);
	/** The `dequeue` whose text goes back into the draft; a removed row asks for none. */
	const [dequeueId, setDequeueId] = useState<number | null>(null);
	const nextId = useRef(0);
	const [modelsOpen, setModelsOpen] = useState(false);

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
	// Questions belong to the session's main agent, and only a writer can answer them.
	const requests = view.agentId === null && live && host ? host.requests : [];

	const waiting = view.agentId === null ? host?.queue : agent?.queue;
	// Each id counts the earlier rows with the same text, so a row keeps its key when the one ahead of it is delivered.
	const queued = QUEUE_TAGS.flatMap(([queue, tag]) =>
		(waiting?.[queue] ?? []).map((text, index, texts) => ({
			queue,
			item: { id: `${queue}:${texts.slice(0, index).filter(t => t === text).length}:${text}`, text, tag },
		})),
	);
	/** Take queued rows out before the agent gets them; edited ones come back into the draft once the server took them. */
	const take = (entries: typeof queued, edit: boolean): boolean | void => {
		if (entries.length === 0) return false;
		const id = ++nextId.current;
		if (edit) setDequeueId(id);
		onDequeue(id, entries.map(({ queue, item }) => ({ queue, text: item.text })));
	};
	useEffect(() => {
		if (!dequeued || dequeued.reqId !== dequeueId) return;
		setDequeueId(null);
		const text = dequeued.texts.join("\n");
		setDraft(current => (current ? `${text}\n${current}` : text));
		completion.composerRef.current?.querySelector("textarea")?.focus();
	}, [dequeued, dequeueId]);
	// The focused pane's composer takes the keyboard once it can be typed in: when the view opens, and when it goes live.
	useEffect(() => {
		if (focused && writable) completion.composerRef.current?.querySelector("textarea")?.focus();
	}, [writable]);
	// As omp's Esc does, the session's queued messages come back into the composer instead of running after the interrupt.
	const interrupt = (): void => {
		take(queued, true);
		onAbort();
	};

	const submit = (text: string, delivery: Delivery): void => {
		onPrompt(text, delivery);
		completion.close();
		setDraft("");
		scrollToEnd();
	};

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
					<PullRequests pullRequests={shown.pullRequests} />
				</>
			);

	const placeholder = !writable
		? phase.phase === "live" && agent && !agent.canMessage
			? "This subagent cannot be messaged."
			: "Messaging is unavailable for this view."
		: working
			? `Steer ${agent ? "this subagent" : "the running turn"}… ${FOLLOW_UP_KEYS} sends once it finishes`
			: agent
				? agent.status === "parked"
					? "Message to revive this subagent…"
					: "Message this subagent…"
				: "Message this session…";

	const directCommand = directCommandOf(draft);
	const shownModel = shown?.model ?? null;
	const thinking = shown?.thinkingLevel ?? null;
	// Collab rooms carry no model or thinking switch, so only sessions this dashboard started over RPC can change them.
	const switchable = view.agentId === null && host?.source === "dashboard" && live ? host : null;
	// The list refreshes on every open, whether a click or the model shortcut opened it.
	const openModels = (open: boolean): void => {
		setModelsOpen(open);
		if (open) onListModels();
	};
	const modelSlot =
		view.agentId !== null ? null : switchable ? (
			<>
				<ModelPicker current={shownModel} list={models} open={modelsOpen} onOpenChange={openModels} onPick={onSetModel} />
				{switchable.thinkingLevels.length > 0 && <ThinkingPicker current={thinking} levels={switchable.thinkingLevels} onPick={onSetThinking} />}
			</>
		) : shownModel || thinking ? (
			<span className="flex min-w-0 items-center gap-3 px-2 text-xs text-muted-foreground" title="Switch this session's model and thinking level from its omp terminal.">
				{shownModel && (
					<span className="truncate">
						<Model selector={shownModel} />
					</span>
				)}
				{thinking && (
					<span className="flex shrink-0 items-center gap-1">
						<Brain aria-hidden="true" className="size-3.5" />
						<span className="sr-only">Thinking level:</span>
						{thinking}
					</span>
				)}
			</span>
		) : null;
	const contextSlot = view.agentId === null && shown?.context ? <ContextRing context={shown.context} /> : null;

	const followUp = (): boolean | void => {
		const text = draft.trim();
		if (!writable || !text || directCommand) return false;
		submit(text, "followUp");
	};
	const onComposerKey = useShortcuts({
		// The textarea's own key, so it needs no focused pane.
		followUp,
		...(focused
			? {
					interrupt: () => {
						if (view.agentId !== null || !writable || !working) return false;
						interrupt();
					},
					dequeue: () => {
						// omp takes back its last steer before its last follow-up.
						const last = queued.findLast(entry => entry.queue === "steering") ?? queued.at(-1);
						return take(last ? [last] : [], true);
					},
					model: () => {
						if (!switchable) return false;
						openModels(true);
					},
					thinking: () => {
						const levels = switchable?.thinkingLevels ?? [];
						if (levels.length === 0) return false;
						onSetThinking(levels[(levels.indexOf(thinking ?? "") + 1) % levels.length]);
					},
				}
			: {}),
	});
	const completion = useCompletion({ draft, setDraft, completions, onComplete, onKeyDown: onComposerKey });
	const followUpButton = writable && working && (
		<Tooltip content={`Send once the turn finishes · ${FOLLOW_UP_KEYS}`} side="top">
			<Button variant="ghost" size="icon-sm" aria-label="Send once the turn finishes" disabled={!draft.trim() || directCommand !== null} onClick={followUp}>
				<ListEnd aria-hidden="true" />
			</Button>
		</Tooltip>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta} status={status} alert={phase.phase === "ended"}>
				{view.agentId === null && host && live && (
					<Button
						variant="secondary"
						size="compact"
						onClick={onEnd}
						title={
							host.source === "dashboard"
								? "Stop the omp process this dashboard started. Its transcript moves to Past sessions, where Resume continues it."
								: `Stop the omp process running in its terminal (pid ${host.pid}). Its transcript moves to Past sessions, where Resume continues it.`
						}
					>
						End session
					</Button>
				)}
				{actions}
			</Header>
			<Transcript view={view} items={items} working={working === true} fork={fork} onFork={onFork} />
			<div className="relative mx-auto w-full max-w-3xl px-6 pb-5">
				{requests[0] && (
					<UserRequestCard
						key={requests[0].id}
						request={requests[0]}
						queued={requests.length - 1}
						onAnswer={answer => onAnswer(requests[0].id, answer)}
					/>
				)}
				{completion.popup}
				<InputMessage
					ref={completion.composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					textareaProps={completion.textareaProps}
					onSend={text => {
						if (!directCommand) submit(text, "steer");
					}}
					leftSlot={modelSlot}
					rightSlot={
						<>
							{contextSlot}
							{followUpButton}
						</>
					}
					placeholder={placeholder}
					disabled={!writable}
					// While a turn runs, Enter and the send button steer it, and Stop interrupts a session's turn.
					status={working ? "streaming" : "idle"}
					onStop={view.agentId === null ? interrupt : undefined}
					queue={queued.map(({ item }) => item)}
					onEditQueued={item => take(queued.filter(entry => entry.item.id === item.id), true)}
					onRemoveQueued={item => take(queued.filter(entry => entry.item.id === item.id), false)}
					sendLabel={`${working ? "Steer" : "Send to"} ${agent ? "subagent" : "session"}`}
				/>
				{directCommand && <DirectCommandNote kind={directCommand} />}
			</div>
		</div>
	);
}
