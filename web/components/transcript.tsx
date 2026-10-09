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
import { createContext, type KeyboardEvent, memo, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
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
} from "@/components/ui/message-scroller";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { modeOf, SPLIT_CLICK } from "../labels";
import { hashForView, type OpenMode, sameView } from "../routing";
import type { StartOf } from "../starts";
import { usePaneLoaded, useTranscript } from "../pane-store";
import { type ActivityItem, type Block, editablePrompt, type ForkPoint, forkPoints, type ToolItem, toBlocks, turnReplies } from "../transcript-view";
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
 * status, and the page's open. `onCancel` stops a running subagent for good; `null` in a room the dashboard cannot
 * write to. The context is `null` in a past session, whose subagents have no view of their own.
 */
export const SubagentLinks = createContext<{
	instanceId: string;
	agents: AgentRow[];
	onOpen: (view: View, mode: OpenMode) => void;
	onCancel: ((view: LiveView & { agentId: string }) => void) | null;
} | null>(null);

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
						{links.onCancel && agent?.status === "running" && (
							<Tooltip content="Cancel subagent: stop it for good, leaving the session's turn running">
								<Button
									variant="ghost"
									size="icon"
									className="size-6 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
									aria-label={`Cancel subagent ${id}`}
									onClick={() => links.onCancel?.(view)}
								>
									<CircleStop className="size-3.5" />
								</Button>
							</Tooltip>
						)}
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

/** The last prompt, rewritten in place. Enter resends it, Shift+Enter breaks the line, and Esc or leaving the field cancels. */
function PromptEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
	const [text, setText] = useState(initial);
	const ref = useRef<HTMLTextAreaElement>(null);
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
			onCancel();
		} else if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			const next = text.trim();
			if (next && next !== initial.trim()) onSave(next);
			else onCancel();
		}
	};
	return (
		<textarea
			ref={ref}
			aria-label="Edit message"
			value={text}
			rows={1}
			onChange={event => setText(event.target.value)}
			onKeyDown={onKeyDown}
			onBlur={onCancel}
			className="block w-[36rem] max-w-full resize-none bg-transparent [field-sizing:content] outline-none"
		/>
	);
}

interface TranscriptProps {
	view: View;
	working: boolean;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	/** Replaces the last prompt with `text` and runs it again; omitted where the session cannot rewind. */
	onEdit?: (entryId: string, text: string) => void;
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
	editing: boolean;
	/** The turn is running, which an edit of this message stops; read only while `editing`. */
	working: boolean;
	onFork: (itemId: string, point: ForkPoint) => void;
	onEdit?: (entryId: string, text: string) => void;
	/** Start editing message `id`, or stop editing with `null`. */
	onEditing: (id: string | null) => void;
}

/** One message with its actions. Every prop keeps its identity while the message is unchanged, so a streamed token renders only the row it extends. */
const MessageRow = memo(function MessageRow({
	item, copyable, forkAt, prefill, forking, forkDisabled, failed, editAt, editing, working, onFork, onEdit, onEditing,
}: MessageRowProps) {
	const copied = copyText(item);
	const point = forkAt === null ? null : { entryId: forkAt, prefill };
	const edit = editAt !== null && onEdit ? { entryId: editAt, run: onEdit } : null;
	const inEdit = edit !== null && editing;
	return (
		<MessageScrollerItem messageId={item.id} className="flex flex-col">
			<ChatMessage
				from={item.kind}
				time={item.kind === "user" ? (item.from ?? undefined) : undefined}
				files={item.kind === "user" ? item.files : undefined}
				images={item.kind === "user" ? item.images : undefined}
				actions={
					inEdit ? (
						<span>{working ? "Enter stops the turn and resends · Esc cancels" : "Enter resends from here · Esc cancels"}</span>
					) : copyable || point || edit ? (
						<>
							{copyable && <CopyButton text={copied} />}
							{edit && <EditButton onEdit={() => onEditing(item.id)} />}
							{point && <ForkButton point={point} forking={forking} disabled={forkDisabled} onFork={() => onFork(item.id, point)} />}
						</>
					) : undefined
				}
				onDoubleClick={edit && !inEdit ? () => onEditing(item.id) : undefined}
				data-item={item.kind}
				data-editing={inEdit || undefined}
				data-streaming={item.kind === "assistant" ? item.streaming : undefined}
			>
				{inEdit ? (
					<PromptEditor
						initial={item.text}
						onSave={text => {
							onEditing(null);
							edit.run(edit.entryId, text);
						}}
						onCancel={() => onEditing(null)}
					/>
				) : item.kind === "user" && (item.text || item.skill) ? (
					<MessageMarkdown text={copyText(item)} prompt />
				) : item.text ? (
					<MessageMarkdown text={item.text} />
				) : null}
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
	const [editing, setEditing] = useState<string | null>(null);
	// Item ids repeat across views (a fork keeps its source's history), so the fork's own view must match.
	const here = fork && sameView(fork.op.view, view) ? fork : null;

	return (
		<MessageScroller className="flex-1">
			<MessageScrollerViewport>
				<MessageScrollerContent className="mx-auto max-w-3xl gap-3 p-3" aria-relevant="additions text" data-transcript>
					{blocks.map(block => {
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
						const isEditing = editing === item.id;
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
								editAt={editable?.itemId === item.id ? editable.entryId : null}
								editing={isEditing}
								working={isEditing && working}
								onFork={onFork}
								onEdit={onEdit}
								onEditing={setEditing}
							/>
						);
					})}
					{loaded && items.length === 0 && !working && empty}
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
