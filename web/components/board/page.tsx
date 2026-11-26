/**
 * The Board page, laid out as a Slack channel: the open Workspace's Board tasks as messages, grouped by author and
 * split by day, each with its thread summary and a hover toolbar, over the composer that posts one; the open Board
 * task's Board thread at the right, as Slack's thread pane. The header's search field, as Slack's, shows its results in
 * place of the Board tasks. The sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import { IconAiBotHead, IconArrowUpRight, IconBubble3, IconBubbleWideNotification, IconCrossMedium, IconHashtag, IconMagnifyingGlass, IconPencil, IconRobot, IconUser } from "central-icons";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type PastSession, type PromptImage, type RosterHost, type Stop, stopOf, type View } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Header, HeaderTitleShown } from "../page-header";
import { AppMark } from "../app-mark";
import { BOT_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardReply, type BoardState, type BoardTask, MAX_TITLE, startedOn, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { splitSuggestions } from "../../../src/shared/transcript";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson, putJson } from "../../api";
import { errorText } from "../../../src/json";
import { useShowConversation } from "../../pane-store";
import { UNREAD } from "../../reads";
import { activityControl } from "../../activity";
import { boardDraftKey, boardThreadDraftKey } from "../../composer-drafts";
import { useStoredState } from "../../stored-state";
import { onPageEscape } from "../../shortcuts";
import { useMinute } from "../../use-minute";
import { Age } from "../age";
import { Separator, useDragSeparator } from "../drag-separator";
import { useDashboardActions } from "../dashboard-context";
import { useModulesOff } from "../../modules-off";
import type { CoreData } from "../module-views";
import { NewSession } from "../new-session";
import { ViewConversation } from "../pane";
import type { ChangesSession } from "../overview-changes";
import { type DetailsTab, DetailsSidebarFrame } from "../details-sidebar-frame";
import { sessionOverviewTab, sessionWorkTabs, useOpenTabOnNew, useSessionWork, workTabOpeners } from "../session-details";
import { newIdsOnOpen } from "../../details-tabs";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute, BoardView } from "./module";
import { PageHashContext } from "../../page-hash";
import { boardTabsOn, ChannelTabs, WorkspaceTab } from "./tabs";
import { boardPageHash, boardWorkspaces, hashForBoard, hashForBoardSession, revealSessionTab, revealThreadTab, THREAD_TABS } from "./sidebar";
import { replyText } from "./search";
import { BoardSearchField, type BoardSearchFieldHandle, SearchResults } from "./search-view";
import { botRows } from "../../bots-model";
import { BotsGallery } from "../bots/bots-gallery";
import { boardActions, SessionActions } from "./actions";

interface BoardPageProps {
	route: BoardRoute;
	core: CoreData;
	state: BoardState | null;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function BoardPage({ route, core, state, disabled, onChange }: BoardPageProps) {
	useMinute();
	const [off] = useModulesOff();
	const searchField = useRef<BoardSearchFieldHandle>(null);
	if (state === null) return <p className="px-6 py-6 text-sm text-muted-foreground">Loading the Board…</p>;
	if (route.bots)
		return (
			<section aria-label="Bots" className="flex min-h-0 min-w-[360px] flex-1 flex-col">
				<Header leading={<IconRobot aria-hidden className="size-4 shrink-0 text-muted-foreground" />} title="Bots" />
				<HeaderTitleShown.Provider value={false}>
					<div className="flex min-h-0 flex-1">
						{/* Each Bot opens in its own Workspace's Bots tab. */}
						<PageHashContext.Provider value={page => boardPageHash(page.kind === "bots" && page.target !== null ? (core.bots?.find(bot => bot.id === page.target)?.cwd ?? null) : null)(page)}>
							<BotsGallery rows={core.bots && botRows(core.bots, core.sessions.hosts, core.botLasts)} routines={core.routines} />
						</PageHashContext.Provider>
					</div>
				</HeaderTitleShown.Provider>
			</section>
		);
	const { open: openWorkspace } = boardWorkspaces(state, core.workspaces, core.workspace, route);
	const open = openWorkspace?.cwd ?? null;
	const name = openWorkspace ? folder(openWorkspace.cwdDisplay) : "No workspace";
	const tasks = state.tasks.filter(task => task.workspace === open);
	const tabs = boardTabsOn(off);
	// A tab whose module is off is gone, so its address opens Messages.
	const view: BoardView = tabs.some(each => each.id === route.view.tab) ? route.view : { tab: "messages", thread: null };
	const thread = view.tab !== "messages" || view.thread === null ? null : (tasks.find(task => task.id === view.thread) ?? null);
	return (
		<div className="flex h-full min-h-0 flex-1">
			<section aria-label="Board" className="flex min-w-[360px] flex-1 flex-col">
				<Header leading={<IconHashtag aria-hidden className="size-4 shrink-0 text-muted-foreground" />} title={name} ruled={false}>
					{openWorkspace && view.tab === "messages" && (
						<BoardSearchField
							key={`${route.search?.query ?? ""}|${route.search?.scope ?? ""}`}
							ref={searchField}
							current={route.search}
							channel={name}
							thread={thread?.id ?? null}
							searchHref={search => hashForBoard(open, thread?.id ?? null, { search })}
						/>
					)}
				</Header>
				<ChannelTabs tab={view.tab} tabs={tabs} workspace={open} />
				{view.tab === "messages" && route.search ? (
					<SearchResults state={state} route={route} workspace={openWorkspace} core={core} />
				) : view.tab === "messages" ? (
					<>
						{/* The composer sits inside the scroller's provider so a post jumps to the end, as Slack does for your own message. */}
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
														<TaskMessage state={state} task={task} sessions={core.sessions} open={task.id === thread?.id} grouped={!!previous && continues(previous, task)} href={hashForBoard(open, task.id)} disabled={disabled} onChange={onChange} />
													</li>
												);
											})}
										</ol>
									</MessageScrollerContent>
								</MessageScrollerViewport>
								<MessageScrollerButton />
							</MessageScroller>
							{openWorkspace && <Composer key={openWorkspace.cwd} workspace={openWorkspace} core={core} disabled={disabled} onChange={onChange} />}
						</MessageScrollerProvider>
					</>
				) : (
					<HeaderTitleShown.Provider value={false}>
						{/* A column, as the page area beside the page column is, so every tab's page takes the full width. */}
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">
							<WorkspaceTab view={view} workspace={open} core={core} disabled={disabled} />
						</div>
					</HeaderTitleShown.Provider>
				)}
			</section>
			{thread && openWorkspace && (
				<Thread
					key={thread.id}
					state={state}
					task={thread}
					reply={route.reply}
					core={core}
					workspace={openWorkspace}
					channel={name}
					closeHref={hashForBoard(open, null, { search: route.search })}
					onSearch={() => searchField.current?.scopeTo("thread")}
					disabled={disabled}
					onChange={onChange}
				/>
			)}
		</div>
	);
}

export const folder = (display: string): string => display.split("/").filter(Boolean).pop() ?? display;

/** Slack starts a later message from the same author within five minutes of the last one without its avatar and name. */
const GROUP_MS = 5 * 60_000;

const authorKey = (by: BoardAuthor): string => (by.kind === "user" ? "user" : by.sessionId);

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

/** The author's square picture: yours for you, omp's mark for a session. */
export function Avatar({ by, size = "message" }: { by: BoardAuthor; sessions: KnownSessions; size?: "message" | "summary" }) {
	const box = size === "message" ? "size-9 rounded-lg text-sm" : "size-6 rounded-md text-[11px]";
	if (by.kind === "user") return <YourAvatar size={size} box={box} />;
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-muted", box)}>
			<AppMark className={size === "message" ? "size-5" : "size-3.5"} />
		</span>
	);
}

/** The author's name: "omp agent" with a tag that says it is a session, as Slack tags an app, then the session's title, which opens its conversation in its Board thread. */
function AuthorName({ by, sessions, state, workspace }: { by: BoardAuthor; sessions: KnownSessions; state: BoardState; workspace: string }) {
	if (by.kind === "user") return <span className="text-[15px] font-bold">You</span>;
	const title = sessionLabel(by.sessionId, sessions).name;
	return (
		<span className="flex min-w-0 items-center gap-1">
			<span className="shrink-0 text-sm font-bold">omp agent</span>
			<SessionTag />
			<a {...activityControl("board.session.open")} href={hashForBoardSession(state, workspace, by.sessionId)} onClick={revealSessionTab} title={title} className="truncate text-xs text-muted-foreground hover:underline">
				{title}
			</a>
		</span>
	);
}

export function SessionTag() {
	return <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Session</span>;
}

/** One message row: avatar, name, and time, or for a grouped one only the time on hover in the avatar's place. */
function MessageRow({ by, at, sessions, state, workspace, grouped, highlighted = false, toolbar, children }: { by: BoardAuthor; at: number; sessions: KnownSessions; state: BoardState; workspace: string; grouped: boolean; highlighted?: boolean; toolbar?: ReactNode; children: ReactNode }) {
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
						<AuthorName by={by} sessions={sessions} state={state} workspace={workspace} />
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

/** Where a Board task in work stands: no session yet, its session working, or its session stopped for you, as `stopOf` says. */
type Work = { kind: "starting" } | { kind: "working"; sessionId: string } | { kind: "waiting"; sessionId: string; stop: Stop };

/** Board task `task`'s {@link Work}, `null` once it is done or waits on another Board task. */
function workOf(state: BoardState, task: BoardTask, sessions: KnownSessions): Work | null {
	const status = statusOf(state, task);
	if (status.kind !== "ready" && status.kind !== "claimed") return null;
	const sessionId = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	if (sessionId === null) return { kind: "starting" };
	const host = sessions.hosts.find(each => each.sessionId === sessionId);
	const stop = host ? stopOf(host) : null;
	return stop ? { kind: "waiting", sessionId, stop } : { kind: "working", sessionId };
}

/** What a Board task in work shows: shimmering while a session starts or works, else in amber what its session waits on you for, then `detail`. */
function WorkLabel({ work, detail }: { work: Work; detail: string | null }) {
	const [label, rest] =
		work.kind === "starting"
			? ["Starting a session…", null]
			: work.kind === "working"
				? ["Working on it…", detail]
				: work.stop.kind === "ask"
					? ["Asks you", work.stop.request.title]
					: [work.stop.kind === "input" ? "Waiting for your input" : "Waiting for your reply", detail];
	return (
		<span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
			<span className={cn("shrink-0", work.kind === "waiting" ? "font-semibold text-amber-600 dark:text-amber-400" : "shimmer-text")}>{label}</span>
			{rest && <span className="truncate text-muted-foreground">{rest}</span>}
		</span>
	);
}

/** A row under a Board task still in work, in the thread summary's style: who works on it and how it stands, as a Slack bot shows it is thinking; it opens the thread with its Thread tab in front. */
function WorkingLine({ work, sessions, href }: { work: Work; sessions: KnownSessions; href: string }) {
	const sessionId = work.kind === "starting" ? null : work.sessionId;
	return (
		<a {...activityControl("board.task.open")} href={href} onClick={revealThreadTab} className="mt-1 -ml-[5px] flex max-w-md items-center gap-2 rounded-lg border border-transparent p-1 hover:border-border hover:bg-background">
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

/** A Board task's or reply's text as Markdown, with single line breaks kept, as a Bot's message shows; `(edited)` after it once its author edited it, as Slack marks one. */
function BoardText({ text, editedAt }: { text: string; editedAt?: number }) {
	return (
		<div className="max-w-conversation min-w-0 text-sm leading-relaxed">
			<MessageMarkdown text={text} preset={BOT_MESSAGE_PRESET} />
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
				<span className="mr-auto text-xs text-muted-foreground">Saving stops its session's turn and resends it</span>
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
/** Replies past the ones seen that someone else wrote: the unread count, as Slack's thread pill. */
const unreadOf = (task: BoardTask, seenCount: number | undefined): number => said(task).slice(seenCount ?? 0).filter(reply => reply.by.kind !== "user").length;

function TaskMessage({ state, task, sessions, open, grouped, href, disabled, onChange }: { state: BoardState; task: BoardTask; sessions: KnownSessions; open: boolean; grouped: boolean; href: string; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const replies = said(task);
	const seenMap = useSeen();
	const work = workOf(state, task, sessions);
	const session = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	const [editing, setEditing] = useState(false);
	const toolbar = (
		<>
			{task.by.kind === "user" && !editing && <EditButton disabled={disabled} onEdit={() => setEditing(true)} />}
			<Tooltip content="Reply in thread">
				<Button {...activityControl("board.task.open")} variant="ghost" size="icon-xs" aria-label={`Reply in thread #${task.id}`} render={<a href={href} />}>
					<IconBubble3 />
				</Button>
			</Tooltip>
			{session && (
				<Tooltip content="Open its session">
					<Button {...activityControl("board.session.open")} variant="ghost" size="icon-xs" aria-label="Open its session" render={<a href={href} onClick={revealSessionTab} />}>
						<IconArrowUpRight />
					</Button>
				</Tooltip>
			)}
			{!open && unreadOf(task, 0) > 0 && <MarkUnreadButton onMark={() => markSeen(task.id, 0)} />}
		</>
	);
	return (
		<MessageRow by={task.by} at={task.at} sessions={sessions} state={state} workspace={task.workspace} grouped={grouped} highlighted={open} toolbar={toolbar}>
			<TaskBody task={task} editor={editing ? <MessageEditor text={task.text || task.title} onSave={text => onChange({ op: "edit", by: { kind: "user" }, task: task.id, text })} onClose={() => setEditing(false)} /> : undefined} />
			{replies.length > 0 ? (
				<ThreadSummary replies={replies} unread={open ? 0 : unreadOf(task, seenMap[task.id])} work={work} sessions={sessions} href={href} />
			) : (
				work && <WorkingLine work={work} sessions={sessions} href={href} />
			)}
		</MessageRow>
	);
}

/** Who replied, how many replies, and when the last came, or while a session works on it how it stands in that place, which opens the thread, as under a Slack message. */
function ThreadSummary({ replies, unread, work, sessions, href }: { replies: Extract<BoardReply, { by: BoardAuthor }>[]; unread: number; work: Work | null; sessions: KnownSessions; href: string }) {
	const worker: BoardAuthor[] = work && work.kind !== "starting" ? [{ kind: "session", sessionId: work.sessionId }] : [];
	// Every session draws the same omp mark, so all sessions count as one avatar.
	const authors = [...new Map([...worker, ...replies.map(reply => reply.by)].map(by => [by.kind === "session" ? "session" : authorKey(by), by])).values()].slice(0, 5);
	const last = replies.at(-1);
	return (
		<a
			{...activityControl("board.task.open")}
			href={href}
			onClick={revealThreadTab}
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
			{unread > 0 && (
				<span aria-label={`${unread} unread`} className="rounded-full bg-blue-600 px-1.5 text-[11px] leading-4 font-bold text-white tabular-nums dark:bg-blue-500">
					{unread}
				</span>
			)}
			{work ? (
				<span className="min-w-0 group-hover/summary:hidden">
					<WorkLabel work={work} detail={null} />
				</span>
			) : (
				last && (
					<span className="text-[13px] text-muted-foreground group-hover/summary:hidden">
						Last reply <Age at={last.at} className="tabular-nums" /> ago
					</span>
				)
			)}
			<span className="hidden flex-1 text-[13px] text-muted-foreground group-hover/summary:inline">View thread</span>
		</a>
	);
}

/** What a composer sends: its text with its text files, the images it attached, and how the session runs. */
type ComposerSend = { prompt: string; images: PromptImage[]; model: BoardLaunch["model"]; thinking: string | null; skill: string | null };

/** `prompt` with its images saved by the server and shown under it by path, since the Board's log keeps text only. */
async function withImages(prompt: string, images: PromptImage[]): Promise<string> {
	if (images.length === 0) return prompt;
	const { paths } = await putJson<{ paths: string[] }>("/api/board/images", { images });
	return [prompt, ...paths.map(path => `![image](<${path}>)`)].filter(Boolean).join("\n\n");
}

/** The New session composer, in the open Workspace: sending posts a Board task, and the session that starts on it runs on the model, thinking level, and skill picked here. */
function Composer({ workspace, core, disabled, onChange }: { workspace: Workspace; core: CoreData; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const { send } = useDashboardActions();
	const { scrollToEnd } = useMessageScroller();
	const post = async ({ prompt, images, model, thinking, skill }: ComposerSend) => {
		if (!prompt && images.length === 0) return;
		scrollToEnd();
		const [first = ""] = prompt.split("\n");
		const title = !first ? "Image" : first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE - 1)}…` : first;
		const text = await withImages(prompt, images);
		await onChange({ op: "post", by: { kind: "user" }, workspace: workspace.cwd, title, ...(text !== title ? { text } : {}), launch: { model, thinking, skill } });
	};
	return (
		<div {...activityControl("board.post")} className="shrink-0">
			<NewSession
				board={{ placeholder: `Message ${folder(workspace.cwdDisplay)}: a session starts on it`, sendLabel: "Post and start a session" }}
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

const THREAD_WIDTH = 400;
const MIN_THREAD = 320;
const MAX_THREAD = 900;
/** Narrowest the Board tasks get beside the thread, as the channel's `min-w-[360px]` says. */
const MIN_CHANNEL = 360;
const STEP = 16;

const clampThread = (width: number, room: number): number => Math.round(Math.max(MIN_THREAD, Math.min(MAX_THREAD, room - MIN_CHANNEL, width)));

/** The Board thread as Slack's thread pane, at the width you drag its left edge to, under the session details sidebar's tab row: **Thread**, the Board task, a line with the reply count, the replies, and the reply box; then the conversation and sidebar tabs of the session its replies wake. Escape closes it. */
function Thread({ state, task, reply, core, workspace, channel, closeHref, onSearch, disabled, onChange }: { state: BoardState; task: BoardTask; reply: number | null; core: CoreData; workspace: Workspace; channel: string; closeHref: string; onSearch: () => void; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const sessions = core.sessions;
	const replyCount = said(task).length;
	useEffect(() => markSeen(task.id, replyCount), [task.id, replyCount]);
	// The thread shows the session a reply wakes, or on a done Board task the last one that worked on it; a thread with none, or one not listed yet, shows only **Thread**.
	const target = wakeTarget(task, { kind: "user" }) ?? (task.doneAt !== null ? (startedOn(task).at(-1) ?? null) : null);
	const name = target ? sessionLabel(target, sessions).name : null;
	const host = target ? (sessions.hosts.find(each => each.sessionId === target) ?? null) : null;
	const past = target ? (sessions.past.find(each => each.sessionId === target) ?? null) : null;
	const instanceId = host?.instanceId ?? null;
	const view = useMemo<View | null>(() => (instanceId !== null ? { kind: "live", instanceId, agentId: null } : past && target ? { kind: "past", sessionId: target } : null), [instanceId, past, target]);
	// Opened on a picked reply, the thread holds still; your own reply there makes it follow the end again.
	const [sentOn, setSentOn] = useState<number | null>(null);
	const follow = reply === null || sentOn === reply;
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
	useEffect(
		() =>
			onPageEscape(event => {
				if (event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]:not([aria-label="Suggested prompts"])')) return;
				event.preventDefault();
				location.hash = closeHref;
			}),
		[closeHref],
	);
	const label = `Thread #${task.id} in #${channel}`;
	const thread: DetailsTab<"thread"> = {
		value: "thread",
		icon: IconBubble3,
		name: "Thread",
		control: "board.thread.tab.thread",
		count: 0,
		scrollsItself: true,
		content: (
			<ThreadMessages
				state={state}
				task={task}
				reply={reply}
				follow={follow}
				sessions={sessions}
				disabled={disabled}
				onChange={onChange}
				onMarkUnread={from => {
					markSeen(task.id, from);
					location.hash = closeHref;
				}}
			>
				<ThreadComposer task={task} name={name} core={core} workspace={workspace} disabled={disabled} onChange={onChange} onSend={() => setSentOn(reply)} />
			</ThreadMessages>
		),
	};
	const close = (
		<>
			<Tooltip content="Search in thread">
				<Button {...activityControl("board.thread.search")} variant="ghost" size="icon-xs" aria-label="Search in thread" onClick={onSearch}>
					<IconMagnifyingGlass />
				</Button>
			</Tooltip>
			<Button {...activityControl("board.thread.close")} variant="ghost" size="icon-xs" aria-label="Close thread" render={<a href={closeHref} />}>
				<IconCrossMedium />
			</Button>
		</>
	);
	return (
		<aside aria-label={`Thread #${task.id}`} style={{ width }} className="relative flex max-w-[calc(100%-360px)] shrink-0 flex-col border-l border-border">
			<Separator {...resize} axis="vertical" label="Resize the thread" min={MIN_THREAD} max={MAX_THREAD} now={width} className="inset-y-0 -left-1.5 w-3 cursor-col-resize select-none" />
			{target && name && view ? (
				<SessionThreadTabs label={label} thread={thread} close={close} sessionId={target} name={name} view={view} host={host} past={past} core={core} />
			) : (
				<DetailsSidebarFrame label={label} storageKey={THREAD_TABS} defaultTab="thread" cwd={null} tabs={[thread]} trailing={close} />
			)}
		</aside>
	);
}


/** Opens the woken session's PRs, Linear, and Review tabs in the thread once it shows one, as the session details sidebar does. */
const THREAD_OPENERS = workTabOpeners(THREAD_TABS);

/** Opens the woken session's conversation tab the first time each session shows in a thread while the page is open. */
const conversationShown = newIdsOnOpen();

/** The thread's tabs once it has a session to wake: **Thread**, that session's conversation, then the session details sidebar's **Overview**, **Diffs**, **PRs**, **Artifacts**, **Review**, and **Linear** for it, opened from +. */
function SessionThreadTabs({ label, thread, close, sessionId, name, view, host, past, core }: { label: string; thread: DetailsTab<"thread">; close: ReactNode; sessionId: string; name: string; view: View; host: RosterHost | null; past: PastSession | null; core: CoreData }) {
	const row = host ?? past;
	const working = host?.status === "working";
	// Loaded while the thread shows, not only on its conversation tab: the Artifacts and Review tabs read it too.
	useShowConversation(view);
	const work = useSessionWork({ view, sessionId, working, hosts: core.sessions.hosts, row }, THREAD_OPENERS);
	const ids = useMemo(() => [sessionId], [sessionId]);
	useOpenTabOnNew(conversationShown, THREAD_TABS, sessionId, ids, "session");
	const session = useMemo<ChangesSession>(() => ({ sessionId, cwd: row?.cwd ?? null, facts: row }), [sessionId, row]);
	const tabs: DetailsTab<string>[] = [
		thread,
		{
			value: "session",
			icon: IconAiBotHead,
			name,
			control: "board.thread.tab.session",
			count: 0,
			scrollsItself: true,
			content: <ViewConversation view={view} focused={false} host={host} lastHost={null} session={past} models={(view.kind === "live" && core.models.get(view.instanceId)) || UNREAD} workspaces={core.workspaces} header={false} />,
		},
		sessionOverviewTab(view, working, null, session),
		...sessionWorkTabs(work),
	];
	return <DetailsSidebarFrame label={label} storageKey={THREAD_TABS} defaultTab="thread" cwd={row?.cwd ?? null} tabs={tabs} trailing={close} />;
}

/** The **Thread** tab's messages: the Board task, a line with the reply count, then the replies, with reply `reply` (an index of `task.replies`) highlighted, and a working line while the task runs; each reply's **Mark unread** passes how many replies come before it. The Board's notes, such as a claim or a lapsed lease, stay out: the thread shows only what was said. */
function ThreadMessages({ state, task, reply, follow, sessions, disabled, onChange, onMarkUnread, children }: { state: BoardState; task: BoardTask; reply: number | null; follow: boolean; sessions: KnownSessions; disabled: boolean; onChange: (change: BoardChange) => Promise<void>; onMarkUnread: (from: number) => void; children: ReactNode }) {
	const work = workOf(state, task, sessions);
	const replies = said(task);
	const count = replies.length;
	let previous: { at: number; by: BoardAuthor } = task;
	// The message being edited: the Board task, or a reply by its index in `task.replies`.
	const [editing, setEditing] = useState<"task" | number | null>(null);
	const editor = (text: string, reply?: number) => (
		<MessageEditor text={text} onSave={next => onChange({ op: "edit", by: { kind: "user" }, task: task.id, ...(reply === undefined ? {} : { reply }), text: next })} onClose={() => setEditing(null)} />
	);
	const actions = boardActions(task, sessions);
	// Each session's last reply, by its index in `task.replies`: its actions show under it, where the session did them.
	const lastReply = new Map(replies.flatMap(entry => (entry.by.kind === "session" ? [[entry.by.sessionId, task.replies.indexOf(entry)] as const] : [])));
	return (
		<MessageScrollerProvider autoScroll={follow}>
			<MessageScroller className="flex-1">
				<MessageScrollerViewport>
					<MessageScrollerContent className="gap-0 py-2">
						<MessageRow
							by={task.by}
							at={task.at}
							sessions={sessions}
							state={state}
							workspace={task.workspace}
							grouped={false}
							toolbar={task.by.kind === "user" && editing !== "task" ? <EditButton disabled={disabled} onEdit={() => setEditing("task")} /> : undefined}
						>
							<TaskBody task={task} editor={editing === "task" ? editor(task.text || task.title) : undefined} />
						</MessageRow>
						<div className="flex items-center gap-3 px-5 py-2 text-[13px] text-muted-foreground">
							<span className="shrink-0">{count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`}</span>
							<span className="h-px flex-1 bg-border" />
						</div>
						<ol className="flex flex-col">
							{replies.map((entry, position) => {
								const grouped = continues(previous, entry);
								previous = entry;
								const index = task.replies.indexOf(entry);
								const done = entry.by.kind === "session" && lastReply.get(entry.by.sessionId) === index ? actions.get(entry.by.sessionId) : undefined;
								return (
									<li key={index}>
										<MessageScrollerItem messageId={`reply-${index}`}>
											<MessageRow
												by={entry.by}
												at={entry.at}
												sessions={sessions}
												state={state}
												workspace={task.workspace}
												grouped={grouped}
												highlighted={index === reply}
												toolbar={
													editing === index ? undefined : (
														<>
															{entry.by.kind === "user" && <EditButton disabled={disabled} onEdit={() => setEditing(index)} />}
															<MarkUnreadButton onMark={() => onMarkUnread(position)} />
														</>
													)
												}
											>
												{editing === index ? editor(entry.text, index) : <BoardText text={replyText(entry.by, entry.text)} editedAt={entry.editedAt} />}
											</MessageRow>
										</MessageScrollerItem>
										{done && <SessionActions actions={done} />}
									</li>
								);
							})}
						</ol>
						{[...actions].map(([sessionId, each]) => (lastReply.has(sessionId) ? null : <SessionActions key={sessionId} actions={each} />))}
						{work && (
							<div className="px-5 pt-1">
								<WorkingLine work={work} sessions={sessions} href={hashForBoard(task.workspace, task.id)} />
							</div>
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
			{reply !== null && <ScrollToReply reply={reply} />}
			{children}
		</MessageScrollerProvider>
	);
}

/** Scrolls the thread to reply `reply`, centred, once it opens with one picked; the scroller does not follow the end meanwhile. */
function ScrollToReply({ reply }: { reply: number }) {
	const { scrollToMessage } = useMessageScroller();
	useEffect(() => {
		scrollToMessage(`reply-${reply}`, { align: "center" });
	}, [reply, scrollToMessage]);
	return null;
}

/** The thread's `@` menu offers sessions only, so a reply can point its session at another. */
const THREAD_MENTIONS = ["session"] as const;

/** The thread's reply box, the New session composer without its directory picker: the reply wakes the session named `name`, or on a done Board task starts a new one, on the model, thinking level, and skill picked here. A done Board task's session's suggested prompts list under its action bar; each sends itself as the user's reply. */
function ThreadComposer({ task, name, core, workspace, disabled, onChange, onSend }: { task: BoardTask; name: string | null; core: CoreData; workspace: Workspace; disabled: boolean; onChange: (change: BoardChange) => Promise<void>; onSend: () => void }) {
	const last = said(task).at(-1);
	const prompts = task.doneAt !== null && last?.by.kind === "session" ? splitSuggestions(last.text).suggestions : undefined;
	const { send } = useDashboardActions();
	const { scrollToEnd } = useMessageScroller();
	const reply = async ({ prompt, images, model, thinking, skill }: ComposerSend) => {
		if ((!prompt && images.length === 0) || disabled) return;
		onSend();
		scrollToEnd();
		await onChange({ op: "reply", by: { kind: "user" }, task: task.id, text: await withImages(prompt, images), launch: { model, thinking, skill } });
	};
	return (
		<div {...activityControl("board.reply")} className="shrink-0">
			<NewSession
				board={{
					placeholder: task.doneAt !== null ? "Reply to start a new session on it…" : name ? `Reply to ${name}…` : "Reply…",
					sendLabel: task.doneAt !== null ? "Send reply; a new session takes it from the thread" : name ? "Send reply; it wakes the session if it stopped" : "Send reply",
					mentions: THREAD_MENTIONS,
					prompts,
				}}
				cwd={workspace.cwd}
				workspaces={core.workspaces}
				launch={null}
				connected={!disabled}
				completions={core.newSessionCompletions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd: workspace.cwd }, text, cursor })}
				onPickCwd={() => {}}
				onStart={reply}
				todo={null}
				projectId={null}
				draftKey={boardThreadDraftKey(task.id)}
			/>
		</div>
	);
}
