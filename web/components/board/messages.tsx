/**
 * The pieces a Board message is made of, on the Board and in its Board thread alike: when messages group and split by
 * day, the author's picture and name, the message row with its hover toolbar's buttons, the text and labels, the line
 * of a Board task in work, the editor that edits your own message, and the replies of each Board thread you have seen.
 * The page that lays them out is `./page.tsx`.
 */
import { IconAiBotHead, IconBubbleWideNotification, IconCircleCheck, IconPencil, IconUser } from "central-icons";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BoardAuthor, BoardChange, BoardReply, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson } from "../../api";
import { errorText } from "../../../src/json";
import { activityControl } from "../../activity";
import { useStoredState } from "../../stored-state";
import { AppMark } from "../app-mark";
import { BOARD_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { type KnownSessions, sessionLabel } from "../../labels";
import { hashForBoardSession, revealSessionTab, revealThreadTab } from "./sidebar";
import { RoutineAuthorName, RoutineAvatar } from "./routine-author";
import type { Work } from "./work";

export const folder = (display: string): string => display.split("/").filter(Boolean).pop() ?? display;

/** Slack starts a later message from the same author within five minutes of the last one without its avatar and name. */
const GROUP_MS = 5 * 60_000;

const authorKey = (by: BoardAuthor): string => (by.kind === "user" ? "user" : by.kind === "routine" ? `routine:${by.routineId}` : by.sessionId);

function continues(previous: { at: number; by: BoardAuthor }, next: { at: number; by: BoardAuthor }): boolean {
	return authorKey(previous.by) === authorKey(next.by) && next.at - previous.at < GROUP_MS && sameDay(previous.at, next.at);
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

export const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The time in the 36px avatar column, without its AM or PM, as Slack shows it there. */
const shortClock = (at: number): string => clock(at).replace(/\s?[AP]M$/i, "");

export function dayLabel(at: number): string {
	const now = Date.now();
	if (sameDay(at, now)) return "Today";
	if (sameDay(at, now - 86_400_000)) return "Yesterday";
	return new Date(at).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** The day's line across the messages, with its name in a pill, as Slack splits a channel by day. */
function DayDivider({ at }: { at: number }) {
	return (
		<div role="separator" aria-label={dayLabel(at)} className="relative my-2 flex items-center px-6">
			<span className="h-px flex-1 bg-border" />
			<span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-medium text-muted-foreground">{dayLabel(at)}</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

/** Your Slack profile picture, asked once per page load to refresh the stored one, which shows meanwhile; `undefined` when the ask failed. */
let yourPicture: Promise<string | null | undefined> | null = null;

/** Your square picture: your Slack profile picture, else a person. */
function YourAvatar({ size, box }: { size: "message" | "summary"; box: string }) {
	const [url, setUrl] = useStoredState<string | null>("omp-agents.slack-picture", raw => raw || null, value => value ?? "");
	useEffect(() => {
		yourPicture ??= getJson<{ avatarUrl: string | null }>("/api/integrations/slack/me").then(
			answer => answer.avatarUrl,
			() => undefined,
		);
		let live = true;
		void yourPicture.then(found => {
			if (live && found !== undefined && found !== url) setUrl(found);
		});
		return () => {
			live = false;
		};
	}, [url, setUrl]);
	if (url) return <img aria-hidden src={url} alt="" referrerPolicy="no-referrer" className={cn("shrink-0 object-cover", box)} />;
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-foreground text-background", box)}>
			<IconUser className={size === "message" ? "size-5" : "size-3.5"} />
		</span>
	);
}

/** The author's square picture: yours for you, a routine's loop for a routine, omp's mark for a session. */
export function Avatar({ by, size = "message" }: { by: BoardAuthor; sessions: KnownSessions; size?: "message" | "summary" }) {
	const box = size === "message" ? "size-9 rounded-lg text-sm" : "size-6 rounded-md text-[11px]";
	if (by.kind === "user") return <YourAvatar size={size} box={box} />;
	if (by.kind === "routine") return <RoutineAvatar size={size} box={box} />;
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-muted", box)}>
			<AppMark className={size === "message" ? "size-5" : "size-3.5"} />
		</span>
	);
}

/** The author's name: yours; a routine's name; or for a session "omp agent" then the session's title, which opens its conversation in its Board thread. */
function AuthorName({ by, sessions, state, workspace }: { by: BoardAuthor; sessions: KnownSessions; state: BoardState; workspace: string }) {
	if (by.kind === "user") return <span className="text-sm font-semibold">You</span>;
	if (by.kind === "routine") return <RoutineAuthorName routineId={by.routineId} name={by.name} workspace={workspace} />;
	const title = sessionLabel(by.sessionId, sessions).name;
	return (
		<span className="flex min-w-0 items-baseline gap-1.5">
			<span className="shrink-0 text-sm font-semibold">omp agent</span>
			<a {...activityControl("board.session.open")} href={hashForBoardSession(state, workspace, by.sessionId)} onClick={revealSessionTab} title={title} className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
				{title}
			</a>
		</span>
	);
}

/** One message row: avatar, name, and time, or for a grouped one only the time on hover in the avatar's place. */
function MessageRow({ by, at, sessions, state, workspace, grouped, highlighted = false, toolbar, children }: { by: BoardAuthor; at: number; sessions: KnownSessions; state: BoardState; workspace: string; grouped: boolean; highlighted?: boolean; toolbar?: ReactNode; children: ReactNode }) {
	return (
		<div className={cn("group/message relative flex gap-2 px-6 hover:bg-accent/40", grouped ? "py-0.5" : "pt-2 pb-1", highlighted && "bg-accent hover:bg-accent")}>
			<div className="flex w-9 shrink-0 justify-end">
				{grouped ? (
					<time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="pt-0.5 text-xs text-muted-foreground tabular-nums opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100">
						{shortClock(at)}
					</time>
				) : (
					<Avatar by={by} sessions={sessions} />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{!grouped && (
					<span className="flex min-w-0 items-baseline gap-2">
						<AuthorName by={by} sessions={sessions} state={state} workspace={workspace} />
						<time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="shrink-0 text-xs text-muted-foreground tabular-nums hover:underline">
							{clock(at)}
						</time>
					</span>
				)}
				{children}
			</div>
			{toolbar && <div className="invisible absolute -top-4 right-6 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 shadow-sm group-focus-within/message:visible group-hover/message:visible">{toolbar}</div>}
		</div>
	);
}

/** What a Board task in work shows: shimmering while a session starts or works, in red why its session did not start with how to retry, else in amber what its session waits on you for, then `detail`. */
function WorkLabel({ work, detail }: { work: Work; detail: string | null }) {
	if (work.kind === "failed")
		return (
			<span className="flex min-w-0 items-baseline gap-1.5 text-xs">
				<span className="shrink-0 font-semibold text-destructive">Couldn't start a session</span>
				<span title={work.error} className="truncate text-muted-foreground">
					{work.error}
				</span>
				<span className="shrink-0 text-muted-foreground">Reply to try again</span>
			</span>
		);
	const [label, rest] =
		work.kind === "starting"
			? ["Starting a session…", null]
			: work.kind === "working"
				? ["Working on it…", detail]
				: work.stop.kind === "ask"
					? ["Asks you", work.stop.request.title]
					: [work.stop.kind === "input" ? "Waiting for your input" : "Waiting for your reply", detail];
	return (
		<span className="flex min-w-0 items-baseline gap-1.5 text-xs">
			<span className={cn("shrink-0", work.kind === "waiting" ? "font-semibold text-amber-600 dark:text-amber-400" : "shimmer-text")}>{label}</span>
			{rest && <span className="truncate text-muted-foreground">{rest}</span>}
		</span>
	);
}

/** A row under a Board task still in work, in the thread summary's style: who works on it and how it stands, as Slack shows someone typing; it opens the thread with its Thread tab in front. */
function WorkingLine({ work, sessions, href }: { work: Work; sessions: KnownSessions; href: string }) {
	const sessionId = work.kind === "working" || work.kind === "waiting" ? work.sessionId : null;
	return (
		<a {...activityControl("board.task.open")} href={href} onClick={revealThreadTab} className="mt-1 -ml-1 flex max-w-md items-center gap-2 rounded-lg p-1 ring-1 ring-transparent ring-inset hover:bg-background hover:ring-border">
			{sessionId ? (
				<Avatar by={{ kind: "session", sessionId }} sessions={sessions} size="summary" />
			) : (
				<span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
					<IconAiBotHead className="size-4" />
				</span>
			)}
			<WorkLabel work={work} detail={sessionId && sessionLabel(sessionId, sessions).name} />
		</a>
	);
}

/** A Board task's or reply's text as Markdown, with single line breaks kept; `(edited)` after it once its author edited it, as Slack marks one. */
function BoardText({ text, editedAt }: { text: string; editedAt?: number }) {
	return (
		<div className="max-w-conversation min-w-0 text-sm leading-relaxed">
			<MessageMarkdown text={text} preset={BOARD_MESSAGE_PRESET} />
			{editedAt !== undefined && (
				<span title={`Edited ${new Date(editedAt).toLocaleString()}`} className="text-xs text-muted-foreground">
					(edited)
				</span>
			)}
		</div>
	);
}

/** The message's text, or `editor` in its place while you edit it, and its labels. */
function TaskBody({ task, editor }: { task: BoardTask; editor?: ReactNode }) {
	const labels = Object.entries(task.labels);
	return (
		<>
			{editor ?? <BoardText text={task.text || task.title} editedAt={task.editedAt} />}
			{labels.length > 0 && (
				<span className="flex flex-wrap items-center gap-1.5 pt-0.5">
					{labels.map(([key, value]) => (
						<Badge key={key} variant="dot" size="compact" color="gray">
							{key}={value}
						</Badge>
					))}
				</span>
			)}
		</>
	);
}

/** The pencil in your own message's toolbar, which puts its text in a box to edit. */
function EditButton({ disabled, onEdit }: { disabled: boolean; onEdit: () => void }) {
	return (
		<Tooltip content="Edit message">
			<Button {...activityControl("board.message.edit")} variant="ghost" size="icon-xs" aria-label="Edit message" disabled={disabled} onClick={onEdit}>
				<IconPencil />
			</Button>
		</Tooltip>
	);
}

/** Slack's **Mark unread**: the thread counts this reply and those after it as unread again. */
function MarkUnreadButton({ onMark }: { onMark: () => void }) {
	return (
		<Tooltip content="Mark unread">
			<Button {...activityControl("board.message.unread")} variant="ghost" size="icon-xs" aria-label="Mark unread" onClick={onMark}>
				<IconBubbleWideNotification />
			</Button>
		</Tooltip>
	);
}

/** **Close task** on an open Board task: marks it done as you, which ends the session working on it; a reply reopens it. */
function CloseTaskButton({ task, disabled, onChange }: { task: BoardTask; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	return (
		<Tooltip content="Close task">
			<Button {...activityControl("board.task.close")} variant="ghost" size="icon-xs" aria-label={`Close Board task #${task.id}`} disabled={disabled} onClick={() => void onChange({ op: "close", by: { kind: "user" }, task: task.id })}>
				<IconCircleCheck />
			</Button>
		</Tooltip>
	);
}

/** Your message's text in a box, as Slack edits one: Enter or **Save** saves it, which stops the turn of the session working from it and sends it the new text; Shift+Enter starts a new line; Escape or **Cancel** leaves it as it was. */
function MessageEditor({ text, onSave, onClose }: { text: string; onSave: (text: string) => Promise<void>; onClose: () => void }) {
	const [draft, setDraft] = useState(text);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const box = ref.current;
		box?.focus();
		box?.setSelectionRange(box.value.length, box.value.length);
	}, []);
	const save = async () => {
		const next = draft.trim();
		if (!next || next === text.trim()) return onClose();
		setPending(true);
		try {
			await onSave(next);
			onClose();
		} catch (failure) {
			setError(errorText(failure));
			setPending(false);
		}
	};
	return (
		<div className="flex max-w-conversation min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background p-2 focus-within:border-ring">
			<textarea
				ref={ref}
				aria-label="Edit message"
				aria-busy={pending || undefined}
				readOnly={pending}
				value={draft}
				rows={1}
				onChange={event => setDraft(event.target.value)}
				onKeyDown={event => {
					if (event.nativeEvent.isComposing) return;
					// Escape is taken here, so the Board thread around the box stays open.
					if (event.key === "Escape") {
						event.preventDefault();
						if (!pending) onClose();
					} else if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						if (!pending) void save();
					}
				}}
				className="block w-full resize-none bg-transparent text-sm leading-relaxed [field-sizing:content] outline-none"
			/>
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			<div className="flex items-center gap-1.5">
				<span className="mr-auto text-xs text-muted-foreground">Saving stops the session's turn and sends your edit</span>
				<Button variant="outline" size="compact" disabled={pending} onClick={onClose}>
					Cancel
				</Button>
				<Button variant="primary" size="compact" disabled={pending} onClick={() => void save()}>
					Save
				</Button>
			</div>
		</div>
	);
}

const said = (task: BoardTask): Extract<BoardReply, { by: BoardAuthor }>[] => task.replies.filter((entry): entry is Extract<BoardReply, { by: BoardAuthor }> => "by" in entry);

/** How many replies of each Board task's thread you have seen, by task id, kept in this browser. */
const SEEN_KEY = "omp-agents.board-thread-seen";
const seenListeners = new Set<() => void>();
let seen: Record<string, number> = {};
try {
	seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
} catch {}
function markSeen(id: number, count: number) {
	if (seen[id] === count) return;
	seen = { ...seen, [id]: count };
	localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
	for (const listener of seenListeners) listener();
}
const useSeen = (): Record<string, number> =>
	useSyncExternalStore(
		listener => {
			seenListeners.add(listener);
			return () => seenListeners.delete(listener);
		},
		() => seen,
	);
/** Replies past the ones seen that someone else wrote: the unread count, as Slack's thread pill. The line a session leaves with a quiet done, having found nothing to report, counts for nothing. */
const unreadOf = (task: BoardTask, seenCount: number | undefined): number => {
	const quiet = new Set(
		task.replies.filter((entry, index) => {
			const before = task.replies[index - 1];
			return "by" in entry && before !== undefined && "note" in before && before.note.kind === "done" && before.note.quiet === true;
		}),
	);
	return said(task).slice(seenCount ?? 0).filter(reply => reply.by.kind !== "user" && !quiet.has(reply)).length;
};

export { authorKey, BoardText, CloseTaskButton, continues, DayDivider, EditButton, MarkUnreadButton, markSeen, MessageEditor, MessageRow, said, sameDay, TaskBody, unreadOf, useSeen, WorkingLine, WorkLabel };
