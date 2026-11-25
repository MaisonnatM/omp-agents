/**
 * The Board page, laid out as a Slack channel: the open Workspace's Board tasks as messages, grouped by author and
 * split by day, each with its thread summary and a hover toolbar, over the composer that posts one; the open Board
 * task's Board thread at the right, as Slack's thread pane. The sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import { IconArrowUpRight, IconBubble3, IconCrossMedium, IconHashtag, IconUser } from "central-icons";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { hashForSession } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Header } from "../page-header";
import { BOT_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardNote, type BoardReply, type BoardState, type BoardStatus, type BoardTask, MAX_TITLE, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { boardDraftKey, boardThreadDraftKey, useComposerDraft } from "../../composer-drafts";
import { useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { useMinute } from "../../use-minute";
import { Age } from "../age";
import { useCompletion } from "../completion-popup";
import { ComposerEditor } from "../composer";
import { DictationButton, DictationRow, useDictation } from "../composer-dictation";
import { Separator, useDragSeparator } from "../drag-separator";
import type { PromptEditorHandle } from "../prompt-editor";
import { useDashboardActions } from "../dashboard-context";
import type { CoreData } from "../module-views";
import { NewSession } from "../new-session";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute } from "./module";
import { boardWorkspaces, hashForBoard } from "./sidebar";

interface BoardPageProps {
	route: BoardRoute;
	core: CoreData;
	state: BoardState | null;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function BoardPage({ route, core, state, disabled, onChange }: BoardPageProps) {
	useMinute();
	if (state === null) return <p className="px-6 py-6 text-sm text-muted-foreground">Loading the Board…</p>;
	const { open: openWorkspace } = boardWorkspaces(state, core.workspaces, core.workspace, route);
	const open = openWorkspace?.cwd ?? null;
	const name = openWorkspace ? folder(openWorkspace.cwdDisplay) : "No workspace";
	const tasks = state.tasks.filter(task => task.workspace === open);
	const thread = route.thread === null ? null : (tasks.find(task => task.id === route.thread) ?? null);
	return (
		<div className="flex h-full min-h-0 flex-1">
			<section aria-label="Board" className="flex min-w-[360px] flex-1 flex-col">
				<Header leading={<IconHashtag aria-hidden className="size-4 shrink-0 text-muted-foreground" />} title={name} />
				<MessageScrollerProvider autoScroll>
					<MessageScroller className="flex-1">
						<MessageScrollerViewport>
							<MessageScrollerContent className="justify-end gap-0 pt-6 pb-2">
								<ChannelIntro name={name} />
								<ol aria-label="Board tasks" className="flex flex-col">
									{tasks.map((task, index) => {
										const previous = tasks[index - 1];
										return (
											<li key={task.id}>
												{(!previous || !sameDay(previous.at, task.at)) && <DayDivider at={task.at} />}
												<TaskMessage state={state} task={task} sessions={core.sessions} open={task.id === route.thread} grouped={!!previous && continues(previous, task)} href={hashForBoard(open, task.id)} />
											</li>
										);
									})}
								</ol>
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton />
					</MessageScroller>
				</MessageScrollerProvider>
				{openWorkspace && <Composer key={openWorkspace.cwd} workspace={openWorkspace} core={core} disabled={disabled} onChange={onChange} />}
			</section>
			{thread && openWorkspace && <Thread key={thread.id} state={state} task={thread} core={core} workspace={openWorkspace} channel={name} closeHref={hashForBoard(open)} disabled={disabled} onChange={onChange} />}
		</div>
	);
}

const folder = (display: string): string => display.split("/").filter(Boolean).pop() ?? display;

/** Slack starts a later message from the same author within five minutes of the last one without its avatar and name. */
const GROUP_MS = 5 * 60_000;

const authorKey = (by: BoardAuthor): string => (by.kind === "user" ? "user" : by.sessionId);

function continues(previous: { at: number; by: BoardAuthor }, next: { at: number; by: BoardAuthor }): boolean {
	return authorKey(previous.by) === authorKey(next.by) && next.at - previous.at < GROUP_MS && sameDay(previous.at, next.at);
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The time in the 36px avatar column, without its AM or PM, as Slack shows it there. */
const shortClock = (at: number): string => clock(at).replace(/\s?[AP]M$/i, "");

function dayLabel(at: number): string {
	const now = Date.now();
	if (sameDay(at, now)) return "Today";
	if (sameDay(at, now - 86_400_000)) return "Yesterday";
	return new Date(at).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** The day's line across the messages, with its name in a pill, as Slack splits a channel by day. */
function DayDivider({ at }: { at: number }) {
	return (
		<div role="separator" aria-label={dayLabel(at)} className="relative my-2 flex items-center px-5">
			<span className="h-px flex-1 bg-border" />
			<span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-semibold">{dayLabel(at)}</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

function ChannelIntro({ name }: { name: string }) {
	return (
		<div className="flex flex-col gap-1 px-5 pb-4">
			<h2 className="flex items-center gap-1 text-xl font-bold">
				<IconHashtag aria-hidden className="size-5" />
				{name}
			</h2>
			<p className="text-sm text-muted-foreground">This is the very beginning of the {name} Board. Each message you send here is a Board task, and a session starts on it.</p>
		</div>
	);
}

const HUES = ["bg-sky-600", "bg-violet-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600", "bg-orange-600"];

function hueOf(id: string): string {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return HUES[Math.abs(hash) % HUES.length] ?? "bg-sky-600";
}

/** The author's square picture: a person for you, a session's initial on its own color for a session. */
function Avatar({ by, sessions, size = "message" }: { by: BoardAuthor; sessions: KnownSessions; size?: "message" | "summary" }) {
	const box = size === "message" ? "size-9 rounded-lg text-sm" : "size-6 rounded-md text-[11px]";
	if (by.kind === "user")
		return (
			<span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-foreground text-background", box)}>
				<IconUser className={size === "message" ? "size-5" : "size-3.5"} />
			</span>
		);
	const name = sessionLabel(by.sessionId, sessions).name;
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center font-semibold text-white", hueOf(by.sessionId), box)}>
			{name.trim().charAt(0).toUpperCase() || "S"}
		</span>
	);
}

/** The author's name, which opens the session for a session, and a tag that says it is one, as Slack tags an app. */
function AuthorName({ by, sessions }: { by: BoardAuthor; sessions: KnownSessions }) {
	if (by.kind === "user") return <span className="text-[15px] font-bold">You</span>;
	return (
		<span className="flex min-w-0 items-center gap-1">
			<a {...activityControl("board.session.open")} href={hashForSession(by.sessionId)} title={sessionLabel(by.sessionId, sessions).name} className="truncate text-sm font-bold hover:underline">
				{sessionLabel(by.sessionId, sessions).name}
			</a>
			<span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Session</span>
		</span>
	);
}

/** One message row: avatar, name, and time, or for a grouped one only the time on hover in the avatar's place. */
function MessageRow({ by, at, sessions, grouped, highlighted = false, toolbar, children }: { by: BoardAuthor; at: number; sessions: KnownSessions; grouped: boolean; highlighted?: boolean; toolbar?: ReactNode; children: ReactNode }) {
	return (
		<div className={cn("group/message relative flex gap-2 px-5 hover:bg-accent/40", grouped ? "py-0.5" : "pt-2 pb-1", highlighted && "bg-amber-100/60 hover:bg-amber-100/80 dark:bg-amber-500/10 dark:hover:bg-amber-500/15")}>
			<div className="flex w-9 shrink-0 justify-end">
				{grouped ? (
					<time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="invisible pt-0.5 text-[11px] text-muted-foreground tabular-nums group-hover/message:visible">
						{shortClock(at)}
					</time>
				) : (
					<Avatar by={by} sessions={sessions} />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{!grouped && (
					<span className="flex min-w-0 items-baseline gap-2">
						<AuthorName by={by} sessions={sessions} />
						<time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="shrink-0 text-xs text-muted-foreground tabular-nums hover:underline">
							{clock(at)}
						</time>
					</span>
				)}
				{children}
			</div>
			{toolbar && <div className="invisible absolute -top-4 right-5 z-10 flex items-center gap-0.5 rounded-[7px] border border-border bg-background p-0.5 shadow-sm group-focus-within/message:visible group-hover/message:visible">{toolbar}</div>}
		</div>
	);
}

function StatusBadge({ status, sessions }: { status: BoardStatus; sessions: KnownSessions }) {
	switch (status.kind) {
		case "ready":
			return (
				<Badge variant="dot" size="compact" color="blue">
					ready
				</Badge>
			);
		case "waiting":
			return (
				<Badge variant="dot" size="compact" color="gray">
					waiting on #{status.on}
				</Badge>
			);
		case "claimed":
			return (
				<Badge variant="dot" size="compact" color="amber">
					claimed by {sessionLabel(status.sessionId, sessions).name} · {Math.max(0, Math.ceil((status.until - Date.now()) / 60_000))} min left
				</Badge>
			);
		case "done":
			return (
				<Badge variant="dot" size="compact" color="green">
					done
				</Badge>
			);
	}
}

/** A Board task's or reply's text as Markdown, with single line breaks kept, as a Bot's message shows. */
function BoardText({ text }: { text: string }) {
	return (
		<div className="max-w-conversation min-w-0 text-sm leading-relaxed">
			<MessageMarkdown text={text} preset={BOT_MESSAGE_PRESET} />
		</div>
	);
}

/** The message's text, its Board task number, status, and labels. */
function TaskBody({ state, task, sessions }: { state: BoardState; task: BoardTask; sessions: KnownSessions }) {
	return (
		<>
			<BoardText text={task.text || task.title} />
			<span className="flex flex-wrap items-center gap-1.5 pt-0.5">
				<span className="text-xs text-muted-foreground tabular-nums">#{task.id}</span>
				<StatusBadge status={statusOf(state, task)} sessions={sessions} />
				{Object.entries(task.labels).map(([key, value]) => (
					<Badge key={key} variant="dot" size="compact" color="gray">
						{key}={value}
					</Badge>
				))}
			</span>
		</>
	);
}

const said = (task: BoardTask): Extract<BoardReply, { by: BoardAuthor }>[] => task.replies.filter((entry): entry is Extract<BoardReply, { by: BoardAuthor }> => "by" in entry);

function TaskMessage({ state, task, sessions, open, grouped, href }: { state: BoardState; task: BoardTask; sessions: KnownSessions; open: boolean; grouped: boolean; href: string }) {
	const replies = said(task);
	const session = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	const toolbar = (
		<>
			<Tooltip content="Reply in thread">
				<Button {...activityControl("board.task.open")} variant="ghost" size="icon-xs" aria-label={`Reply in thread #${task.id}`} render={<a href={href} />}>
					<IconBubble3 />
				</Button>
			</Tooltip>
			{session && (
				<Tooltip content="Open its session">
					<Button {...activityControl("board.session.open")} variant="ghost" size="icon-xs" aria-label="Open its session" render={<a href={hashForSession(session)} />}>
						<IconArrowUpRight />
					</Button>
				</Tooltip>
			)}
		</>
	);
	return (
		<MessageRow by={task.by} at={task.at} sessions={sessions} grouped={grouped} highlighted={open} toolbar={toolbar}>
			<TaskBody state={state} task={task} sessions={sessions} />
			{replies.length > 0 && <ThreadSummary replies={replies} sessions={sessions} href={href} />}
		</MessageRow>
	);
}

/** Who replied, how many replies, and when the last came, which opens the thread, as under a Slack message. */
function ThreadSummary({ replies, sessions, href }: { replies: Extract<BoardReply, { by: BoardAuthor }>[]; sessions: KnownSessions; href: string }) {
	const authors = [...new Map(replies.map(reply => [authorKey(reply.by), reply.by])).values()].slice(0, 5);
	const last = replies.at(-1);
	return (
		<a
			{...activityControl("board.task.open")}
			href={href}
			className="group/summary mt-1 -ml-[5px] flex max-w-md items-center gap-2 rounded-lg border border-transparent p-1 hover:border-border hover:bg-background"
		>
			<span className="flex gap-0.5">
				{authors.map(by => (
					<Avatar key={authorKey(by)} by={by} sessions={sessions} size="summary" />
				))}
			</span>
			<span className="text-[13px] font-bold text-blue-600 hover:underline dark:text-blue-400">
				{replies.length} {replies.length === 1 ? "reply" : "replies"}
			</span>
			{last && (
				<span className="text-[13px] text-muted-foreground group-hover/summary:hidden">
					Last reply <Age at={last.at} className="tabular-nums" /> ago
				</span>
			)}
			<span className="hidden flex-1 text-[13px] text-muted-foreground group-hover/summary:inline">View thread</span>
		</a>
	);
}

/** The New session composer, in the open Workspace: sending posts a Board task, and the session that starts on it runs on the model, thinking level, and skill picked here. */
function Composer({ workspace, core, disabled, onChange }: { workspace: Workspace; core: CoreData; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const { send } = useDashboardActions();
	const post = ({ prompt, model, thinking, skill }: { prompt: string; model: BoardLaunch["model"]; thinking: string | null; skill: string | null }) => {
		if (!prompt) return;
		const [first = ""] = prompt.split("\n");
		const title = first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE - 1)}…` : first;
		void onChange({ op: "post", by: { kind: "user" }, workspace: workspace.cwd, title, ...(prompt !== title ? { text: prompt } : {}), launch: { model, thinking, skill } });
	};
	return (
		<div {...activityControl("board.post")} className="shrink-0">
			<NewSession
				board
				cwd={workspace.cwd}
				workspaces={core.workspaces}
				launch={null}
				connected={!disabled}
				completions={core.newSessionCompletions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd: workspace.cwd }, text, cursor })}
				onPickCwd={cwd => (location.hash = hashForBoard(cwd))}
				onStart={post}
				todo={null}
				projectId={null}
				draftKey={boardDraftKey(workspace.cwd)}
			/>
		</div>
	);
}

function noteText(note: BoardNote, sessions: KnownSessions): string {
	const name = (id: string | null): string => (id === null ? "The session" : sessionLabel(id, sessions).name);
	switch (note.kind) {
		case "started":
			return `Started ${name(note.sessionId)} on this Board task.`;
		case "start-failed":
			return `No session could start on it: ${note.error}`;
		case "claimed":
			return `${name(note.sessionId)} claimed this Board task. Lease 15 min.`;
		case "renewed":
			return `${name(note.sessionId)} renewed its lease.`;
		case "expired":
			return `${name(note.sessionId)}'s lease ran out, so a new session starts on it.`;
		case "unclaimed":
			return `${name(note.sessionId)} never claimed it, so a new session starts on it.`;
		case "ready":
			return `#${note.task} is done, so this Board task is ready.`;
		case "woke":
			return `${name(note.sessionId)} had stopped. The reply woke it.`;
		case "done":
			return `${name(note.sessionId)} marked this Board task done.`;
	}
}

const THREAD_WIDTH = 400;
const MIN_THREAD = 320;
const MAX_THREAD = 900;
/** Narrowest the Board tasks get beside the thread, as the channel's `min-w-[360px]` says. */
const MIN_CHANNEL = 360;
const STEP = 16;

const clampThread = (width: number, room: number): number => Math.round(Math.max(MIN_THREAD, Math.min(MAX_THREAD, room - MIN_CHANNEL, width)));

/** The Board thread as Slack's thread pane, at the width you drag its left edge to: the Board task, a line with the reply count, the replies and the Board's grey lines, and the reply box; Escape closes it. */
function Thread({ state, task, core, workspace, channel, closeHref, disabled, onChange }: { state: BoardState; task: BoardTask; core: CoreData; workspace: Workspace; channel: string; closeHref: string; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const sessions = core.sessions;
	const count = said(task).length;
	const [width, setWidth] = useStoredState("omp-agents.board-thread-width", raw => {
		const stored = Number(raw);
		return stored >= MIN_THREAD && stored <= MAX_THREAD ? stored : THREAD_WIDTH;
	});
	const room = (element: HTMLElement): number => element.closest("aside")!.parentElement!.clientWidth;
	// The line sits on the thread's left edge: dragging it left widens the thread.
	const resize = useDragSeparator({
		value: width,
		onValue: setWidth,
		axis: "vertical",
		direction: -1,
		keyStep: STEP,
		shiftSteps: 4,
		min: MIN_THREAD,
		max: MAX_THREAD,
		reset: THREAD_WIDTH,
		size: room,
		clamp: (next, element) => clampThread(next, room(element)),
		read: (event, start) => clampThread(start.value - (event.clientX - start.coordinate), start.size),
	});
	// Escape closes the thread wherever focus is, unless a menu or dialog is open and takes it first.
	useEffect(() => {
		const close = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
			event.preventDefault();
			location.hash = closeHref;
		};
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [closeHref]);
	// A grey line ends a run of messages, so the reply after it shows its avatar and name again.
	let previous: { at: number; by: BoardAuthor } | null = task;
	return (
		<aside aria-label={`Thread #${task.id}`} style={{ width }} className="relative flex max-w-[calc(100%-360px)] shrink-0 flex-col border-l border-border">
			<Separator {...resize} axis="vertical" label="Resize the thread" min={MIN_THREAD} max={MAX_THREAD} now={width} className="inset-y-0 -left-1.5 w-3 cursor-col-resize select-none" />
			<header className="flex min-h-(--page-header-height) shrink-0 items-center gap-2 border-b border-border px-5">
				<h2 className="text-sm font-semibold">Thread</h2>
				<span className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px] text-muted-foreground">
					<IconHashtag aria-hidden className="size-3.5 shrink-0" />
					<span className="truncate">{channel}</span>
				</span>
				<Button {...activityControl("board.thread.close")} variant="ghost" size="icon-xs" aria-label="Close thread" render={<a href={closeHref} />}>
					<IconCrossMedium />
				</Button>
			</header>
			<MessageScrollerProvider autoScroll>
				<MessageScroller className="flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="gap-0 py-2">
							<MessageRow by={task.by} at={task.at} sessions={sessions} grouped={false}>
								<TaskBody state={state} task={task} sessions={sessions} />
							</MessageRow>
							<div className="flex items-center gap-3 px-5 py-2 text-[13px] text-muted-foreground">
								<span className="shrink-0">
									{count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`}
								</span>
								<span className="h-px flex-1 bg-border" />
							</div>
							<ol className="flex flex-col">
								{task.replies.map((entry, index) => {
									if ("note" in entry) {
										previous = null;
										return (
											<li key={index} className="flex gap-2 px-5 py-0.5 text-[13px] text-muted-foreground">
												<span className="w-9 shrink-0 pt-px text-right text-[11px] tabular-nums">{shortClock(entry.at)}</span>
												<span className="min-w-0 flex-1 italic">{noteText(entry.note, sessions)}</span>
											</li>
										);
									}
									const grouped = previous !== null && continues(previous, entry);
									previous = entry;
									return (
										<li key={index}>
											<MessageRow by={entry.by} at={entry.at} sessions={sessions} grouped={grouped}>
												<BoardText text={entry.text} />
											</MessageRow>
										</li>
									);
								})}
							</ol>
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<ThreadComposer task={task} core={core} workspace={workspace} disabled={disabled} onChange={onChange} />
		</aside>
	);
}

/** The thread's reply box, the session composer without its pickers: `/` and `@` suggestions, dictation, and a draft kept per Board task. */
function ThreadComposer({ task, core, workspace, disabled, onChange }: { task: BoardTask; core: CoreData; workspace: Workspace; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const { send } = useDashboardActions();
	const editorRef = useRef<PromptEditorHandle>(null);
	const draftKey = boardThreadDraftKey(task.id);
	const [draft, setDraft] = useComposerDraft(draftKey, "");
	const target = wakeTarget(task, { kind: "user" });
	const completion = useCompletion({
		editorRef,
		draft,
		setDraft,
		completions: core.newSessionCompletions,
		onComplete: (reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd: workspace.cwd }, text, cursor }),
		composer: { sessionId: target, changed: [] },
	});
	const dictation = useDictation({ composer: disabled ? null : { draftKey, cwd: workspace.cwd }, text: draft, editorRef, send, connected: !disabled });
	const onComposerKey = useShortcuts({
		dictate: dictation.toggle,
		focusComposer: () => {
			const editor = editorRef.current;
			if (!editor?.editable()) return false;
			editor.focus();
		},
	});
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (completion.onMenuKeyDown(event)) return;
		dictation.onKeyDown(event);
		onComposerKey(event);
		// Escape leaves the reply box first, as in a session's composer; a second one closes the thread.
		if (!event.defaultPrevented && event.key === "Escape") {
			event.currentTarget.blur();
			event.preventDefault();
		}
	};
	const reply = (value: string) => {
		const text = value.trim();
		if (!text || disabled) return;
		completion.close();
		void onChange({ op: "reply", by: { kind: "user" }, task: task.id, text });
		setDraft("");
	};
	return (
		<ComposerEditor value={editorRef}>
			<div {...activityControl("board.reply")} className="relative shrink-0 px-3 pb-3">
				{completion.popup}
				<InputMessage
					editorRef={editorRef}
					value={draft}
					onValueChange={completion.onValueChange}
					onSend={reply}
					placeholder={target ? `Reply to ${sessionLabel(target, core.sessions).name}…` : "Reply…"}
					rightSlot={() => <DictationButton dictation={dictation} />}
					disabled={disabled}
					locked={dictation.locked}
					beforeEditor={<DictationRow dictation={dictation} />}
					sendLabel={target ? "Send reply; it wakes the session if it stopped" : "Send reply"}
					editorProps={{ ...completion.editorProps, onKeyDown }}
				/>
			</div>
		</ComposerEditor>
	);
}
