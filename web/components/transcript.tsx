import {
	AppWindow,
	Bot,
	Braces,
	Brain,
	Bug,
	CircleStop,
	Code,
	CornerDownLeft,
	Cpu,
	FilePen,
	FilePlus,
	FileText,
	Flag,
	FolderSearch,
	GitPullRequest,
	Globe,
	GraduationCap,
	History,
	Hourglass,
	Image,
	Lightbulb,
	Link,
	ListTodo,
	type LucideIcon,
	MessageCircleQuestion,
	MessageSquareWarning,
	Monitor,
	OctagonX,
	Plug,
	RefreshCcw,
	Replace,
	SearchCode,
	ShieldCheck,
	Ship,
	Sparkles,
	SquareTerminal,
	StickyNote,
	Target,
	TextSearch,
	Wrench,
} from "lucide-react";
import { createContext, type KeyboardEvent, memo, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRow, LiveView, View } from "../../src/shared/sessions";
import type { Item } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ui/chat-message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerViewport,
	useMessageScroller,
} from "@/components/ui/message-scroller";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { errorText } from "../api";
import { modeOf, SPLIT_CLICK } from "../labels";
import { hashForView, type OpenMode, sameView } from "../routing";
import type { StartOf } from "../starts";
import { usePaneLoaded, useTranscript } from "../pane-store";
import { revealed, useReveal } from "../message-reveal";
import { type ActivityItem, type Block, editablePrompt, type ForkPoint, forkPoints, type ToolItem, toBlocks, turnReplies, withEditedPrompt } from "../transcript-view";
import { useAction } from "../use-action";
import { useCopy } from "../use-copy";
import { MessageMarkdown } from "./message-markdown";
import { StatusDot, statusLabel } from "./status-dot";

/** omp's tool names (`pi-coding-agent/src/tools/builtin-names.ts`, plus its optional and extension tools). */
const TOOL_ICON: Record<string, LucideIcon> = {
	read: FileText,
	write: FilePlus,
	edit: FilePen,
	ast_edit: Replace,
	ast_grep: SearchCode,
	bash: SquareTerminal,
	eval: Code,
	grep: TextSearch,
	glob: FolderSearch,
	find: FolderSearch,
	lsp: Braces,
	debug: Bug,
	ida: Cpu,
	ask: MessageCircleQuestion,
	task: Bot,
	wait: Hourglass,
	yield: CornerDownLeft,
	todo: ListTodo,
	goal: Target,
	think: Lightbulb,
	web_search: Globe,
	web_fetch: Link,
	fetch: Link,
	browser: AppWindow,
	computer: Monitor,
	generate_image: Image,
	github: GitPullRequest,
	ship_stage: Ship,
	checkpoint: Flag,
	rewind: History,
	context_notes: StickyNote,
	new_context: RefreshCcw,
	security_scan: ShieldCheck,
	memory_edit: Brain,
	retain: Brain,
	recall: Brain,
	reflect: Brain,
	learn: GraduationCap,
	manage_skill: Sparkles,
	proc_kill: OctagonX,
	report_issue: MessageSquareWarning,
};

export const NOTICE_TONE: Record<Extract<Item, { kind: "notice" }>["level"], string> = {
	info: "text-muted-foreground",
	warning: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
};

/** Whether finished tool groups show their steps. The tools shortcut flips it for every pane. */
export const ToolsExpanded = createContext(false);

/** Whether tool rows and thinking text stay hidden. Each choice is this browser's, and every pane shares it. */
export interface ActivityVisibility {
	hideTools: boolean;
	hideThinking: boolean;
	toggleTools: () => void;
	toggleThinking: () => void;
}

export const ActivityVisibility = createContext<ActivityVisibility>({
	hideTools: false,
	hideThinking: false,
	toggleTools: () => {},
	toggleThinking: () => {},
});

export const HIDE_TOOL_CALLS_KEY = "omp-agents.hide-tool-calls";
export const HIDE_THINKING_KEY = "omp-agents.hide-thinking";

/**
 * Where a `task` row's subagents open: the live session the transcript belongs to, its registered subagents for their
 * status, and the page's open. `onCancel` stops a running subagent for good, settling once the server has asked omp to;
 * `null` in a room the dashboard cannot write to. The context is `null` in a past session, whose subagents have no view of their own.
 */
export const SubagentLinks = createContext<{
	instanceId: string;
	agents: AgentRow[];
	onOpen: (view: View, mode: OpenMode) => void;
	onCancel: ((view: LiveView & { agentId: string }) => Promise<void>) | null;
} | null>(null);

function CancelAgentButton({ view, onCancel, running }: { view: LiveView & { agentId: string }; onCancel: (view: LiveView & { agentId: string }) => Promise<void>; running: boolean }) {
	const LoaderIcon = useIcon("loader");
	const cancel = useAction(() => onCancel(view), "Could not cancel the subagent");
	if (!running && !cancel.pending) return null;
	return (
		<Tooltip content={cancel.pending ? "Cancelling…" : "Cancel subagent: stop it for good, leaving the session's turn running"}>
			<Button
				variant="ghost"
				size="icon"
				className="size-6 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
				aria-label={cancel.pending ? `Cancelling subagent ${view.agentId}` : `Cancel subagent ${view.agentId}`}
				aria-busy={cancel.pending || undefined}
				disabled={cancel.pending}
				onClick={() => cancel.run()}
			>
				{cancel.pending ? <LoaderIcon className="size-3.5 animate-spin" /> : <CircleStop className="size-3.5" />}
			</Button>
		</Tooltip>
	);
}

/** The subagents a `task` call spawned, each a link to its own view with its status. */
function SpawnedAgents({ ids }: { ids: string[] }) {
	const links = useContext(SubagentLinks);
	const chip = "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-border";
	return (
		<span className="mt-1 flex flex-wrap gap-1.5" data-subagents>
			{ids.map(id => {
				if (!links) {
					return (
						<span key={id} className={cn(chip, "text-muted-foreground")}>
							<span className="truncate">{id}</span>
						</span>
					);
				}
				const view = { kind: "live", instanceId: links.instanceId, agentId: id } as const;
				const agent = links.agents.find(row => row.id === id);
				const facts = agent ? [agent.kind, statusLabel(agent.status), agent.activity].filter(Boolean).join(" · ") : "not registered";
				return (
					<span key={id} className="inline-flex max-w-full items-center gap-0.5">
						<Tooltip content={`${id} · ${facts}. ${SPLIT_CLICK} to open in a split`}>
							<a
								href={hashForView(view)}
								className={cn(chip, "text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring")}
								onClick={event => {
									// Shift- and middle-clicks keep the link's own new-window behavior.
									if (event.button !== 0 || event.shiftKey || event.altKey) return;
									event.preventDefault();
									links.onOpen(view, modeOf(event));
								}}
							>
								{agent && <StatusDot status={agent.status} />}
								<span className="truncate">{id}</span>
							</a>
						</Tooltip>
						{links.onCancel && <CancelAgentButton view={view} onCancel={links.onCancel} running={agent?.status === "running"} />}
					</span>
				);
			})}
		</span>
	);
}

const ActivityGroup = memo(function ActivityGroup({ entries }: { entries: ActivityItem[] }) {
	const expanded = useContext(ToolsExpanded);
	const { hideTools, hideThinking } = useContext(ActivityVisibility);
	const tools = entries.filter((entry): entry is ToolItem => entry.kind === "tool");
	const running =
		tools.some(tool => tool.status === "running") || entries.some(entry => entry.kind === "thinking" && entry.streaming);
	const failed = tools.filter(tool => tool.status === "error").length;
	// A group that spawned subagents stays open, so their links stay one click away.
	const spawned = tools.some(tool => tool.agents.length > 0);
	// Open while running, else as `expanded` says; a manual toggle wins until `expanded` flips.
	const [toggle, setToggle] = useState<{ open: boolean; expanded: boolean } | null>(null);
	const open = toggle?.expanded === expanded ? toggle.open : running || expanded || spawned;
	const header = running
		? "Working"
		: tools.length
			? `Ran ${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`
			: "Thought";
	const visible = entries.filter(entry => (entry.kind === "thinking" ? !hideThinking : !hideTools));
	return (
		<ThinkingSteps open={open} onOpenChange={next => setToggle({ open: next, expanded })} className="w-full max-w-2xl self-start">
			<ThinkingStepsHeader>{header}</ThinkingStepsHeader>
			<ThinkingStepsContent>
				{visible.map((entry, index) =>
					entry.kind === "thinking" ? (
						<ThinkingStep key={entry.id} icon={Brain} label="Thinking" status={entry.streaming ? "active" : "complete"} isLast={index === visible.length - 1}>
							<div data-thinking={entry.streaming ? "live" : "done"}>
								<MessageMarkdown text={entry.text} />
							</div>
						</ThinkingStep>
					) : (
						<ThinkingStep
							key={entry.id}
							icon={Object.hasOwn(TOOL_ICON, entry.name) ? TOOL_ICON[entry.name] : entry.name.startsWith("mcp__") ? Plug : Wrench}
							iconClassName={entry.status === "error" ? "text-red-600 dark:text-red-400" : undefined}
							label={entry.name}
							description={entry.summary || undefined}
							status={entry.status === "running" ? "active" : "complete"}
							isLast={index === visible.length - 1}
						>
							{entry.agents.length > 0 && <SpawnedAgents ids={entry.agents} />}
						</ThinkingStep>
					),
				)}
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
});

function CopyButton({ text }: { text: string }) {
	const { copied, copy } = useCopy();
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	const Icon = copied ? CheckIcon : CopyIcon;
	return (
		<Tooltip content={copied ? "Copied" : "Copy message"}>
			<Button
				variant="ghost"
				size="icon-compact"
				aria-label={copied ? "Copied" : "Copy message"}
				data-copied={copied || undefined}
				onClick={() => copy(text)}
			>
				<Icon />
			</Button>
		</Tooltip>
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
	const button = (
		<Button
			variant="ghost"
			size="icon-compact"
			aria-label={forking ? "Forking" : "Fork from here"}
			aria-busy={forking || undefined}
			disabled={disabled}
			data-fork={point.prefill ? "prompt" : "reply"}
			onClick={onFork}
		>
			{forking ? <LoaderIcon className="animate-spin" /> : <BranchIcon />}
		</Button>
	);
	return <Tooltip content={title} disabled={disabled}>{button}</Tooltip>;
}

function EditButton({ onEdit }: { onEdit: () => void }) {
	const PencilIcon = useIcon("pencil");
	return (
		<Tooltip content="Edit and resend (or double-click the message)">
			<Button variant="ghost" size="icon-compact" aria-label="Edit message" onClick={onEdit}>
				<PencilIcon />
			</Button>
		</Tooltip>
	);
}

interface PromptEditorProps {
	initial: string;
	text: string;
	pending: boolean;
	working: boolean;
	error: string | null;
	onChange: (text: string) => void;
	onSave: () => void;
	onCancel: () => void;
}

function PromptEditor({ initial, text, pending, working, error, onChange, onSave, onCancel }: PromptEditorProps) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const LoaderIcon = useIcon("loader");
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Escape") {
			event.preventDefault();
			if (!pending) onCancel();
		} else if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			if (pending) return;
			const next = text.trim();
			if (next && next !== initial.trim()) onSave();
			else onCancel();
		}
	};
	return (
		<>
			<textarea
				ref={ref}
				aria-label="Edit message"
				aria-busy={pending || undefined}
				readOnly={pending}
				value={text}
				rows={1}
				onChange={event => onChange(event.target.value)}
				onKeyDown={onKeyDown}
				onBlur={pending ? undefined : onCancel}
				className={cn("block w-[36rem] max-w-full resize-none bg-transparent [field-sizing:content] outline-none", pending && "text-muted-foreground")}
			/>
			{pending && (
				<span role="status" className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
					<LoaderIcon className="size-3 animate-spin" />
					Resending…
				</span>
			)}
			{!pending && <span className="mt-1 block text-xs text-muted-foreground">{working ? "Enter stops the turn and resends · Esc cancels" : "Enter resends from here · Esc cancels"}</span>}
			{error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
		</>
	);
}

interface TranscriptProps {
	view: View;
	working: boolean;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	/** Replaces the last prompt with `text` and runs it again; omitted where the session cannot rewind. */
	onEdit?: (entryId: string, text: string) => Promise<void>;
	/** Shown in place of the transcript, once it loaded, until its first item or turn. */
	empty?: ReactNode;
}

/** A prompt or a reply: the user's and the agent's words. */
type MessageItem = Exclude<Item, ActivityItem | Extract<Item, { kind: "notice" }>>;

/** What a message's copy button copies: a skill prompt as the user typed it, not the skill's text. `item.text` is the reply with its suggestions block already split off, so the body it renders is uniform. */
const copyText = (item: MessageItem): string =>
	item.kind === "user" && item.skill ? [`/skill:${item.skill}`, item.text].filter(Boolean).join(" ") : item.text;

interface MessageRowProps {
	item: MessageItem;
	copyable: boolean;
	/** The entry omp forks at from this message, or `null` where it cannot fork. */
	forkAt: string | null;
	/** Forking this message starts the composer with it to edit. */
	prefill: boolean;
	forking: boolean;
	forkDisabled: boolean;
	/** Why forking this message failed. */
	failed: string | null;
	/** The entry an edit of this message replaces, or `null` where it cannot be edited. */
	editAt: string | null;
	editor?: ReactNode;
	onFork: (itemId: string, point: ForkPoint) => void;
	onEditing: (item: Extract<Item, { kind: "user" }>, entryId: string) => void;
}

/** One message with its actions. Every prop keeps its identity while the message is unchanged, so a streamed token renders only the row it extends. */
const MessageRow = memo(function MessageRow({
	item, copyable, forkAt, prefill, forking, forkDisabled, failed, editAt, editor, onFork, onEditing,
}: MessageRowProps) {
	const copied = copyText(item);
	const point = forkAt === null ? null : { entryId: forkAt, prefill };
	const edit = editAt !== null && item.kind === "user" ? () => onEditing(item, editAt) : undefined;
	return (
		<MessageScrollerItem messageId={item.id} className="flex flex-col">
			<ChatMessage
				from={item.kind}
				time={item.kind === "user" ? (item.from ?? undefined) : undefined}
				files={item.kind === "user" ? item.files : undefined}
				images={item.kind === "user" ? item.images : undefined}
				actions={
					editor ? undefined : copyable || point || edit ? (
						<>
							{copyable && <CopyButton text={copied} />}
							{edit && <EditButton onEdit={edit} />}
							{point && <ForkButton point={point} forking={forking} disabled={forkDisabled} onFork={() => onFork(item.id, point)} />}
						</>
					) : undefined
				}
				onDoubleClick={editor ? undefined : edit}
				data-item={item.kind}
				data-editing={editor ? true : undefined}
				data-streaming={item.kind === "assistant" ? item.streaming : undefined}
			>
				{editor ?? (item.kind === "user" && (item.text || item.skill) ? (
					<MessageMarkdown text={copyText(item)} prompt />
				) : item.text ? (
					<MessageMarkdown text={item.text} />
				) : null)}
			</ChatMessage>
			{failed && (
				<p role="alert" className={cn(item.kind === "user" ? "self-end" : "self-start", "text-xs", NOTICE_TONE.error)}>
					{failed}
				</p>
			)}
		</MessageScrollerItem>
	);
});

/**
 * The scrolling message list. It follows new output until the reader scrolls up; the button jumps back to the end.
 * It reads the view's items itself, so a streamed token renders it and the outline alone, and of its rows only the
 * ones whose message changed. It renders again for fork state or callbacks, not with the page around it.
 */
export const Transcript = memo(function Transcript({ view, working, fork, onFork, onEdit, empty }: TranscriptProps) {
	const items = useTranscript(view);
	const loaded = usePaneLoaded(view);
	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;
	const forks = useMemo(() => forkPoints(items), [items]);
	const replies = useMemo(() => turnReplies(items, working), [items, working]);
	const shown = useRef<Block[]>([]);
	const blocks = useMemo(() => (shown.current = toBlocks(items, shown.current)), [items]);
	const editable = useMemo(() => (onEdit ? editablePrompt(items) : null), [items, onEdit]);
	const [editing, setEditing] = useState<{
		item: Extract<Item, { kind: "user" }>;
		position: number;
		entryId: string;
		text: string;
		submitted: string | null;
		error: string | null;
		save: NonNullable<TranscriptProps["onEdit"]>;
	} | null>(null);
	const resend = useAction(async (edit: NonNullable<typeof editing>) => {
		const sending = { ...edit, submitted: edit.text.trim() };
		setEditing(sending);
		try {
			await sending.save(sending.entryId, sending.submitted);
			setEditing(null);
		} catch (error) {
			setEditing(current => current === sending ? { ...sending, error: errorText(error) } : current);
			throw error;
		}
	}, "Could not resend the message");
	const beginEditing = useCallback((item: Extract<Item, { kind: "user" }>, entryId: string) => {
		const save = onEdit;
		if (!save) return;
		setEditing(current => current ?? {
			item,
			position: blocks.findIndex(block => block.kind === "item" && block.item.id === item.id),
			entryId,
			text: item.text,
			submitted: null,
			error: null,
			save,
		});
	}, [blocks, onEdit]);
	const visibleBlocks = useMemo(() => withEditedPrompt(blocks, editing), [blocks, editing]);
	// Item ids repeat across views (a fork keeps its source's history), so the fork's own view must match.
	const here = fork && sameView(fork.op.view, view) ? fork : null;
	const revealId = useReveal(view);
	const { scrollToMessage } = useMessageScroller();
	// The command palette opened this view at a match. Scroll once the whole transcript has loaded, a frame after the
	// scroller places it at its end, so that placement does not undo the scroll. The reveal ends when the scroll lands,
	// or at once when the loaded transcript lacks the message; a scroller that has not measured it yet retries on the next render.
	useEffect(() => {
		if (revealId === null || !loaded) return;
		if (!items.some(item => item.id === revealId)) return revealed(view);
		const frame = requestAnimationFrame(() => {
			if (scrollToMessage(revealId, { align: "start" })) revealed(view);
		});
		return () => cancelAnimationFrame(frame);
	}, [revealId, loaded, items, view, scrollToMessage]);

	return (
		<MessageScroller className="flex-1">
			<MessageScrollerViewport>
				<MessageScrollerContent className="mx-auto max-w-3xl gap-3 p-3" aria-relevant="additions text" data-transcript>
					{visibleBlocks.map(block => {
						if (block.kind === "activity") {
							return (
								<MessageScrollerItem key={block.id} messageId={block.id} className="flex flex-col">
									<ActivityGroup entries={block.entries} />
								</MessageScrollerItem>
							);
						}
						const item = block.item;
						if (item.kind === "notice") {
							return (
								<MessageScrollerItem key={item.id} messageId={item.id} className="flex flex-col">
									<p className={cn("self-center whitespace-pre-line text-center text-xs", NOTICE_TONE[item.level])} data-item="notice">
										{item.text}
									</p>
								</MessageScrollerItem>
							);
						}
						const point = forks.get(item.id);
						const edit = editing?.item.id === item.id ? editing : null;
						return (
							<MessageRow
								key={item.id}
								item={item}
								copyable={item.kind === "assistant" ? replies.has(item.id) && !item.streaming : copyText(item).trim() !== ""}
								forkAt={point?.entryId ?? null}
								prefill={point?.prefill ?? false}
								forking={here?.phase === "starting" && here.op.itemId === item.id}
								forkDisabled={fork?.phase === "starting"}
								failed={here?.phase === "failed" && here.op.itemId === item.id ? here.error : null}
								editAt={!editing && editable?.itemId === item.id ? editable.entryId : null}
								editor={edit ? (
									<PromptEditor
										initial={edit.item.text}
										text={edit.text}
										pending={resend.pending}
										working={working}
										error={edit.error}
										onChange={text => setEditing(current => current ? { ...current, text, error: null } : current)}
										onSave={() => resend.run(edit)}
										onCancel={() => setEditing(null)}
									/>
								) : undefined}
								onFork={onFork}
								onEditing={beginEditing}
							/>
						);
					})}
					{loaded && items.length === 0 && !working && !editing && empty}
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
});
