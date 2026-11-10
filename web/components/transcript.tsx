/** `Transcript`, a session's messages, thinking, and tool calls as rendered in a pane. */
import {
	AppWindow,
	Bot,
	Braces,
	Brain,
	Bug,
	CircleCheck,
	Code,
	CornerDownLeft,
	Cpu,
	FilePen,
	FilePlus,
	Eye,
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
import { createContext, Fragment, type KeyboardEvent, memo, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { taskText } from "../../src/shared/routine-message";
import type { PromptFile } from "../../src/shared/prompt-files";
import { type Item, skillInvocation } from "../../src/shared/transcript";
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
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { mediaSrc } from "../api";
import { SPLIT_CLICK, subagentModeOf } from "../labels";
import { hashForView, sameView } from "../routing";
import type { StartOf } from "../starts";
import { usePaneLoaded, useTranscript } from "../pane-store";
import { revealed, useReveal } from "../message-reveal";
import { type ActivityItem, EMPTY_TRANSCRIPT, type ForkPoint, replacingPrompt, resendOf, type ToolItem, transcriptModel, withEditedPrompt } from "../transcript-view";
import { useAction } from "../use-action";
import { useCopy } from "../use-copy";
import { type ToolChipLabels, ToolChipsContext } from "./tool-chips";
import { AttachedFileDialog } from "./file-dialog";
import { PromptFileChips } from "./prompt-file-chips";
import { ImageViewer } from "./media-viewer";
import { MessageMarkdown, SESSION_AGENT_PRESET, SESSION_PROMPT_PRESET, SESSION_STREAMING_PRESET } from "./message-markdown";
import { StatusDot, statusLabel } from "./status-dot";
import { RoutineRunCard } from "./routines/routine-run-card";
import { BotMessageCard } from "./bots/bot-message-card";
import { PromptHistory } from "./prompt-history";
import { SessionTodosCard } from "./session-todos-card";
import { CancelAgentButton, SubagentLinks } from "./subagent-links";
import type { ChangesSession } from "./todos-card-changes";
import { FindBar, PaneFocused } from "./find-bar";
import { TranscriptMinimap } from "./transcript-minimap";
import { latestReviewPages, requestReview } from "../review-pages";
import { BROWSER_AVAILABLE } from "./browser-panel";

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

/** Whether the transcript draws its tool and thinking groups and the Todos card's subagents, files, images, and sources; a Bot's page turns it off, so its conversation reads as a chat, keeping only the chips of {@link ToolChipsContext}. */
export const ActivityShown = createContext(true);

export const HIDE_TOOL_CALLS_KEY = "omp-agents.hide-tool-calls";
export const HIDE_THINKING_KEY = "omp-agents.hide-thinking";

/** How long a resize of the transcript's lane rests before its rows lay out again at the new width. */
const RESIZE_REST_MS = 150;

/** Opens the transcript's image viewer at image `at` of prompt or tool item `id`; outside a `Transcript` it does nothing. */
const OpenImage = createContext<(id: string, at: number) => void>(() => {});
/** Opens a prompt's attached file in the transcript's dialog; outside a `Transcript` it does nothing. */
const OpenFile = createContext<(file: PromptFile) => void>(() => {});

/** The subagents a `task` call spawned, each a link to its own view with its status. */
function SpawnedAgents({ ids }: { ids: string[] }) {
	const links = useContext(SubagentLinks);
	const chip = "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-border";
	return (
		<span className="-mt-1 ml-6 flex flex-wrap gap-1.5" data-subagents>
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
									links.onOpen(view, subagentModeOf(event));
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

/** The images a tool's result returned, as thumbnails under its line; one opens large in the transcript's viewer. */
function ToolImages({ id, srcs, tool }: { id: string; srcs: string[]; tool: string }) {
	const openImage = useContext(OpenImage);
	const label = (index: number): string => `Image ${index + 1} from ${tool}`;
	return (
		<span className="-mt-1 ml-6 flex flex-wrap gap-1.5" data-tool-images>
			{srcs.map((src, index) => (
				// A result's images never change, so their order names them.
				<button
					{...activityControl("media-viewer.open")}
					key={index}
					type="button"
					aria-label={`Open ${label(index).toLowerCase()}`}
					onClick={() => openImage(id, index)}
					className="cursor-zoom-in overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
				>
					<img src={mediaSrc(src)} alt={label(index)} loading="lazy" className="h-32 max-w-60 object-contain" />
				</button>
			))}
		</span>
	);
}

export const ActivityGroup = memo(function ActivityGroup({ entries }: { entries: ActivityItem[] }) {
	const expanded = useContext(ToolsExpanded);
	const { hideTools, hideThinking } = useContext(ActivityVisibility);
	const LoaderIcon = useIcon("loader");
	const tools = entries.filter((entry): entry is ToolItem => entry.kind === "tool");
	const running =
		tools.some(tool => tool.status === "running") || entries.some(entry => entry.kind === "thinking" && entry.streaming);
	const failed = tools.filter(tool => tool.status === "error").length;
	// A group that spawned subagents or returned images stays open, so their links and images stay in sight.
	const pinned = tools.some(tool => tool.agents.length > 0 || tool.images);
	// Open while running, else as `expanded` says; a manual toggle wins until `expanded` flips.
	const [toggle, setToggle] = useState<{ open: boolean; expanded: boolean } | null>(null);
	const open = toggle?.expanded === expanded ? toggle.open : running || expanded || pinned;
	const header = running
		? "Working"
		: tools.length
			? `Ran ${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`
			: "Thought";
	const visible = entries.filter(entry => (entry.kind === "thinking" ? !hideThinking : !hideTools));
	return (
		<TraceCollapsible open={open} onOpenChange={next => setToggle({ open: next, expanded })} className="max-w-2xl self-start">
			<TraceCollapsibleTrigger {...activityControl("transcript.activity-group")}>
				<TraceLine status={running ? "running" : undefined}>
					<TraceIcon>{running ? <LoaderIcon className="animate-spin" /> : tools.length ? <CircleCheck /> : <Brain />}</TraceIcon>
					<TraceTitle>{header}</TraceTitle>
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<Trace>
					{visible.map(entry => {
						if (entry.kind === "thinking") {
							return (
								<TraceCollapsible key={entry.id} defaultOpen>
									<TraceCollapsibleTrigger>
										<TraceLine status={entry.streaming ? "running" : undefined}>
											<TraceIcon>
												<Brain />
											</TraceIcon>
											<TraceTitle>{entry.streaming ? "Thinking" : "Thought"}</TraceTitle>
										</TraceLine>
									</TraceCollapsibleTrigger>
									<TraceCollapsibleContent className="text-[13px]">
										<div data-thinking={entry.streaming ? "live" : "done"}>
											<MessageMarkdown text={entry.text} />
										</div>
									</TraceCollapsibleContent>
								</TraceCollapsible>
							);
						}
						const Icon = Object.hasOwn(TOOL_ICON, entry.name) ? TOOL_ICON[entry.name]! : entry.name.startsWith("mcp__") ? Plug : Wrench;
						return (
							<Fragment key={entry.id}>
								<TraceLine status={entry.status === "ok" ? undefined : entry.status}>
									<TraceIcon>
										<Icon />
									</TraceIcon>
									<TraceTitle>
										{entry.name}
										{entry.summary && <span className="text-muted-foreground/70"> {entry.summary}</span>}
									</TraceTitle>
								</TraceLine>
								{entry.agents.length > 0 && <SpawnedAgents ids={entry.agents} />}
								{entry.images && <ToolImages id={entry.id} srcs={entry.images} tool={entry.name} />}
							</Fragment>
						);
					})}
				</Trace>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
});

/** A chip under an activity group for each label `chips` gives a call that finished in it, once per label; one with an address is a link to it. */
function ToolChips({ shown }: { shown: ToolChip[] }) {
	return shown.map(({ name, label, href, icon: Icon }) => {
		const className = "mt-1.5 inline-flex items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground";
		const content = (
			<>
				<Icon aria-hidden className="size-3.5 shrink-0" />
				{label}
			</>
		);
		return href ? (
			<a key={label} href={href} className={cn(className, "transition-colors hover:bg-accent hover:text-foreground")} data-tool-chip={name}>
				{content}
			</a>
		) : (
			<p key={label} className={className} data-tool-chip={name}>
				{content}
			</p>
		);
	});
}

/**
 * One row of the transcript. A settled row, any row but the last, skips its layout and paint while it is off screen,
 * once the whole transcript has laid out and the row itself has laid out once, so a streamed token lays out what is on
 * screen and not every row above it, and a row that arrives off screen, such as with a loaded history, still remembers
 * its real height first. Every row remembers its last laid-out size, so a skipped row keeps its height and the scroller,
 * the minimap, and a jump to a message measure the row's own box as before. The inner box reaches 4px past the row, so a
 * focus ring or the chat history's flash at its edge is not clipped by the skip's paint containment.
 */
function Row({ messageId, settled, className, children }: { messageId: string; settled: boolean; className?: string; children: ReactNode }) {
	// The second frame comes after the browser laid out the row in the first one.
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setSeen(true));
		});
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<MessageScrollerItem messageId={messageId}>
			<div
				className={cn(
					"-m-1 flex flex-col p-1 [contain-intrinsic-block-size:auto_6rem]",
					settled && seen && "group-data-[laid-out]/transcript:[content-visibility:auto]",
					className,
				)}
			>
				{children}
			</div>
		</MessageScrollerItem>
	);
}

type ToolChip = { name: string; label: string; href: string | null; icon: LucideIcon };

/** A group of tool calls and thinking, with a chip for each label `chips` gives a call that finished in it. Memoized on its block, so a token leaves a settled group as it is. */
const ActivityRow = memo(function ActivityRow({ id, entries, settled, shown, chips }: { id: string; entries: ActivityItem[]; settled: boolean; shown: boolean; chips: ToolChipLabels }) {
	const chipsShown = useMemo(() => {
		const byLabel = new Map<string, ToolChip>();
		for (const entry of entries) {
			if (entry.kind !== "tool" || entry.status !== "ok" || !Object.hasOwn(chips, entry.name)) continue;
			const { label, href, icon } = chips[entry.name]!;
			const text = label(entry);
			if (!byLabel.has(text)) byLabel.set(text, { name: entry.name, label: text, href: href?.(entry) ?? null, icon });
		}
		return [...byLabel.values()];
	}, [entries, chips]);
	if (!shown && chipsShown.length === 0) return null;
	return (
		<Row messageId={id} settled={settled}>
			{shown && <ActivityGroup entries={entries} />}
			<ToolChips shown={chipsShown} />
		</Row>
	);
});

function CopyButton({ text, label = "Copy message" }: { text: string; label?: string }) {
	const { copied, copy } = useCopy();
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	const Icon = copied ? CheckIcon : CopyIcon;
	return (
		<Tooltip content={copied ? "Copied" : label}>
			<Button
				variant="ghost"
				size="icon-compact"
				aria-label={copied ? "Copied" : label}
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

/** Opens the pages a reply's `review-pages` fence lists as tabs of the session's Browser. */
function ReviewButton({ onReview }: { onReview: () => void }) {
	return (
		<Tooltip content="Review visuals in the Browser">
			<Button {...activityControl("browser.review-visuals")} variant="ghost" size="icon-compact" aria-label="Review visuals" onClick={onReview}>
				<Eye />
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
	/** Starts a fork at a message; omitted where the session cannot fork, which leaves out the fork buttons. */
	onFork?: (itemId: string, point: ForkPoint) => void;
	/** Replaces the last prompt with `text` and runs it again; omitted where the session cannot rewind. */
	onEdit?: (entryId: string, text: string) => Promise<void>;
	/** Shown in place of the transcript, once it loaded, until its first item or turn. */
	empty?: ReactNode;
	/** The session whose files, images, and sources the Todos card lists; omitted, the card lists none. */
	changes?: ChangesSession;
}

/** A prompt or a reply: the user's and the agent's words. */
type MessageItem = Extract<Item, { kind: "user" | "assistant" }>;

type RoutineItem = Extract<Item, { kind: "routine" }>;

/** What a message's copy button copies: a skill prompt as the user typed it, not the skill's text. `item.text` is the reply with its suggestions block already split off, so the body it renders is uniform. */
const copyText = (item: MessageItem): string => (item.kind === "user" && item.skill ? skillInvocation(item.skill, item.text) : item.text);

/** A routine's message, as its card. Memoized on the item, so a streamed token leaves it as it is. */
const RoutineRow = memo(function RoutineRow({ item, settled }: { item: RoutineItem; settled: boolean }) {
	return (
		<Row messageId={item.id} settled={settled}>
			<RoutineRunCard item={item} copy={<CopyButton text={taskText(item.message)} label={item.message.sent.kind === "command" ? "Copy command" : "Copy prompt"} />} />
		</Row>
	);
});

/** Another Bot's message, as its card. Memoized on the item, so a streamed token leaves it as it is. */
const BotMessageRow = memo(function BotMessageRow({ item, settled }: { item: Extract<Item, { kind: "bot-message" }>; settled: boolean }) {
	return (
		<Row messageId={item.id} settled={settled}>
			<BotMessageCard message={item.message} />
		</Row>
	);
});

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
	/** The live session whose Browser a reply's **Review visuals** opens its pages in, or `null` where there is none. */
	browser: string | null;
	/** It took the place of a pending prompt already on screen, so it shows at once without its entrance motion. */
	replacing: boolean;
	/** It is not the transcript's last row, so it may skip layout while off screen. */
	settled: boolean;
	onFork?: (itemId: string, point: ForkPoint) => void;
	onEditing: (item: Extract<Item, { kind: "user" }>, entryId: string) => void;
}

/** One message with its actions. Every prop keeps its identity while the message is unchanged, so a streamed token renders only the row it extends. */
const MessageRow = memo(function MessageRow({
	item, copyable, forkAt, prefill, forking, forkDisabled, failed, editAt, editor, browser, replacing, settled, onFork, onEditing,
}: MessageRowProps) {
	const copied = copyText(item);
	const openImage = useContext(OpenImage);
	const point = forkAt === null || !onFork ? null : { entryId: forkAt, prefill };
	const edit = editAt !== null && item.kind === "user" ? () => onEditing(item, editAt) : undefined;
	const pending = item.kind === "user" && item.pending === true;
	const openFile = useContext(OpenFile);
	const files = item.kind === "user" && item.files?.length ? item.files : null;
	const pages = useMemo(() => (browser !== null && item.kind === "assistant" ? latestReviewPages([item]) : []), [browser, item]);
	const review = browser !== null && pages.length > 0 ? () => requestReview({ instanceId: browser, pages }) : undefined;
	return (
		// The dimming sits on the wrapper: the message's entrance motion sets its own inline opacity.
		<Row messageId={item.id} settled={settled} className={cn(pending && "opacity-60")}>
			<ChatMessage
				{...(replacing ? { initial: false } : {})}
				from={item.kind}
				time={item.kind === "user" ? (item.from ?? undefined) : undefined}
				files={files && <PromptFileChips files={files} onOpen={openFile} />}
				images={item.kind === "user" ? item.images?.map(mediaSrc) : undefined}
				onOpenImage={index => openImage(item.id, index)}
				actions={
					editor ? undefined : copyable || point || edit || review ? (
						<>
							{copyable && <CopyButton text={copied} />}
							{review && <ReviewButton onReview={review} />}
							{edit && <EditButton onEdit={edit} />}
							{point && onFork && <ForkButton point={point} forking={forking} disabled={forkDisabled} onFork={() => onFork(item.id, point)} />}
						</>
					) : undefined
				}
				onDoubleClick={editor ? undefined : edit}
				data-item={item.kind}
				data-editing={editor ? true : undefined}
				data-streaming={item.kind === "assistant" ? item.streaming : undefined}
				data-pending={pending || undefined}
			>
				{editor ?? (item.kind === "user" && (item.text || item.skill) ? (
					<MessageMarkdown text={copyText(item)} preset={SESSION_PROMPT_PRESET} />
				) : item.text ? (
					// A streaming reply keeps its fences as code, so a diagram or chart draws once, from its whole source.
					<MessageMarkdown text={item.text} preset={item.kind === "assistant" && item.streaming ? SESSION_STREAMING_PRESET : SESSION_AGENT_PRESET} />
				) : null)}
			</ChatMessage>
			{failed && (
				<p role="alert" className={cn(item.kind === "user" ? "self-end" : "self-start", "text-xs", NOTICE_TONE.error)}>
					{failed}
				</p>
			)}
		</Row>
	);
});

/**
 * The scrolling message list. It follows new output until the reader scrolls up; the button jumps back to the end.
 * It reads the view's items itself and builds their model once, from the one before, for its rows, its minimap, its chat
 * history, and its Todos card, so a streamed token redoes the last turn alone and renders only the rows whose message
 * changed. It renders again for fork state or callbacks, not with the page around it.
 */
export const Transcript = memo(function Transcript({ view, working, fork, onFork, onEdit, empty, changes }: TranscriptProps) {
	const items = useTranscript(view);
	const loaded = usePaneLoaded(view);
	const last = items.at(-1);
	const streaming = last?.kind === "assistant" && last.streaming;
	const modelRef = useRef(EMPTY_TRANSCRIPT);
	const model = useMemo(() => (modelRef.current = transcriptModel(items, working, modelRef.current)), [items, working]);
	const { blocks, forks, replies, images } = model;
	// Settled rows skip layout off screen only once every row has laid out, so each remembers its real height. The
	// second frame comes after the browser laid out the first one. Anything that changes rows' heights while off screen,
	// another view, tools expanded or hidden, thinking hidden, or the lane's width, lays every row out in full again first.
	// The lane's first width counts at once; a new one counts once a resize rests, so a drag does not lay every row out on
	// each frame of it.
	const expanded = useContext(ToolsExpanded);
	const paneFocused = useContext(PaneFocused);
	const { hideTools, hideThinking } = useContext(ActivityVisibility);
	const [laneWidth, setLaneWidth] = useState(0);
	const laneRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const lane = laneRef.current;
		if (!lane) return;
		let timer: Timer | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const width = Math.round(entry?.contentRect.width ?? 0);
			setLaneWidth(current => (current === 0 ? width : current));
			clearTimeout(timer);
			timer = setTimeout(() => setLaneWidth(width), RESIZE_REST_MS);
		});
		observer.observe(lane);
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	}, []);
	const layoutKey = `${hashForView(view)}|${expanded}|${hideTools}|${hideThinking}|${laneWidth}`;
	const hasRows = blocks.length > 0;
	const [laidOut, setLaidOut] = useState<string | null>(null);
	useEffect(() => {
		if (!hasRows || laidOut === layoutKey) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setLaidOut(layoutKey));
		});
		return () => cancelAnimationFrame(frame);
	}, [hasRows, laidOut, layoutKey]);
	// The image the viewer shows, by its tool item and its place in that item's images, so new images do not move it.
	const [image, setImage] = useState<{ id: string; at: number } | null>(null);
	const openImage = useCallback((id: string, at: number) => setImage({ id, at }), []);
	const imageIndex = image ? images.findIndex(entry => entry.id === image.id && entry.at === image.at) : -1;
	const shownImage = images[imageIndex];
	// An image that left the transcript, such as after a rewrite, closes the viewer for good rather than reopening when it returns.
	useEffect(() => {
		if (image && imageIndex < 0) setImage(null);
	}, [image, imageIndex]);
	// A dialog the transcript holds, so the pending prompt's row giving way to the live one leaves it open.
	const [file, setFile] = useState<PromptFile | null>(null);
	const previousItems = useRef<Item[]>([]);
	const replacing = useMemo(() => {
		const id = replacingPrompt(previousItems.current, items);
		previousItems.current = items;
		return id;
	}, [items]);
	const editable = onEdit ? model.editable : null;
	// The text being written; whether its resend runs or failed lives in `resend` alone, keyed to this object.
	const [editing, setEditing] = useState<{
		item: Extract<Item, { kind: "user" }>;
		position: number;
		entryId: string;
		text: string;
		save: NonNullable<TranscriptProps["onEdit"]>;
	} | null>(null);
	const resend = useAction(async (edit: NonNullable<typeof editing>, submitted: string) => {
		await edit.save(edit.entryId, submitted);
		setEditing(current => (current === edit ? null : current));
	}, null);
	const { submitted, error: resendError } = resendOf(editing, resend.state);
	// Reads the blocks through `modelRef`, so a streamed token keeps the callback, and the memoized rows, as they are.
	const beginEditing = useCallback((item: Extract<Item, { kind: "user" }>, entryId: string) => {
		const save = onEdit;
		if (!save) return;
		setEditing(current => current ?? {
			item,
			position: modelRef.current.blocks.findIndex(block => block.kind === "item" && block.item.id === item.id),
			entryId,
			text: item.text,
			save,
		});
	}, [onEdit]);
	const visibleBlocks = useMemo(() => withEditedPrompt(blocks, editing && { ...editing, submitted }), [blocks, editing, submitted]);
	// Item ids repeat across views (a fork keeps its source's history), so the fork's own view must match.
	const here = fork && sameView(fork.op.view, view) ? fork : null;
	const revealId = useReveal(view);
	const toolChips = useContext(ToolChipsContext);
	const activityShown = useContext(ActivityShown);
	const subagents = useContext(SubagentLinks);
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
		<OpenImage.Provider value={openImage}>
		<OpenFile.Provider value={setFile}>
			<div className="@container/conversation relative flex min-h-0 flex-1 flex-col" data-conversation>
				<SessionTodosCard
					phases={model.todos}
					view={view}
					working={working}
					changes={activityShown ? changes : undefined}
					subagents={activityShown ? subagents : null}
					ship={changes?.sessionId ? (changes.facts?.ship ?? null) : null}
				/>
				<MessageScroller className="@container min-h-0 flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent
							ref={laneRef}
							className="group/transcript conversation-lane gap-3 p-3"
							aria-relevant="additions text"
							data-transcript
							data-laid-out={laidOut === layoutKey || undefined}
						>
							{visibleBlocks.map((block, index) => {
								const settled = index < visibleBlocks.length - 1;
								if (block.kind === "activity") {
									return <ActivityRow key={block.id} id={block.id} entries={block.entries} settled={settled} shown={activityShown} chips={toolChips} />;
								}
								const item = block.item;
								if (item.kind === "notice") {
									return (
										<Row key={item.id} messageId={item.id} settled={settled}>
											<p className={cn("self-center whitespace-pre-line text-center text-xs", NOTICE_TONE[item.level])} data-item="notice">
												{item.text}
											</p>
										</Row>
									);
								}
								if (item.kind === "routine") return <RoutineRow key={item.id} item={item} settled={settled} />;
								if (item.kind === "bot-message") return <BotMessageRow key={item.id} item={item} settled={settled} />;
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
												pending={submitted !== null}
												working={working}
												error={resendError}
												onChange={text => setEditing(current => current ? { ...current, text } : current)}
												onSave={() => resend.run(edit, edit.text.trim())}
												onCancel={() => setEditing(null)}
											/>
										) : undefined}
										browser={BROWSER_AVAILABLE && view.kind === "live" ? view.instanceId : null}
										replacing={item.id === replacing}
										settled={settled}
										onFork={onFork}
										onEditing={beginEditing}
									/>
								);
							})}
							{loaded && items.length === 0 && !working && !editing && empty}
							{working && !streaming && (
								<Row messageId="thinking" settled={false}>
									<ThinkingIndicator className="self-start" />
								</Row>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<FindBar root={laneRef} enabled={paneFocused} label="Find in conversation" className="conversation-lane px-3" />
					<TranscriptMinimap turns={model.outline} />
					<PromptHistory view={view} turns={model.outline} />
					<MessageScrollerButton {...activityControl("transcript.scroll-to-bottom")} />
				</MessageScroller>
			</div>
			{shownImage && (
				<ImageViewer
					src={shownImage.src}
					caption={shownImage.caption}
					index={imageIndex}
					count={images.length}
					previousLabel="Previous image"
					nextLabel="Next image"
					onIndex={next => setImage({ id: images[next]!.id, at: images[next]!.at })}
					onClose={() => setImage(null)}
				/>
			)}
			{file && <AttachedFileDialog file={file} onClose={() => setFile(null)} />}
		</OpenFile.Provider>
		</OpenImage.Provider>
	);
});
