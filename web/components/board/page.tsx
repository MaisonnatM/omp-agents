/**
 * The Board page, laid out as a Slack channel: the open Workspace's Board tasks as messages, grouped by author and
 * split by day, each with its thread summary and a hover toolbar, over the composer that posts one; the open Board
 * task's Board thread at the right, as Slack's thread pane. The sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import { IconAiBotHead, IconArrowUpRight, IconBubble3, IconCrossMedium, IconHashtag, IconUser } from "central-icons";
import { type ReactNode, useEffect, useMemo } from "react";
import { hashForSession, type PastSession, type RosterHost, type View } from "../../../src/shared/sessions";
import { splitSuggestions } from "../../../src/shared/transcript";
import type { Workspace } from "../../../src/shared/workspaces";
import { Header, HeaderTitleShown } from "../page-header";
import { BOT_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardReply, type BoardState, type BoardTask, MAX_TITLE, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson } from "../../api";
import { useShowConversation } from "../../pane-store";
import { UNREAD } from "../../reads";
import { activityControl } from "../../activity";
import { boardDraftKey, boardThreadDraftKey } from "../../composer-drafts";
import { useStoredState } from "../../stored-state";
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
import { boardTabsOn, ChannelTabs, WorkspaceTab } from "./tabs";
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
	const [off] = useModulesOff();
	if (state === null) return <p className="px-6 py-6 text-sm text-muted-foreground">Loading the Board…</p>;
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
				<Header leading={<IconHashtag aria-hidden className="size-4 shrink-0 text-muted-foreground" />} title={name} ruled={false} />
				<ChannelTabs tab={view.tab} tabs={tabs} workspace={open} />
				{view.tab === "messages" ? (
					<>
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
														<TaskMessage state={state} task={task} sessions={core.sessions} open={task.id === thread?.id} grouped={!!previous && continues(previous, task)} href={hashForBoard(open, task.id)} />
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
					</>
				) : (
					<HeaderTitleShown.Provider value={false}>
						<div className="flex min-h-0 flex-1">
							<WorkspaceTab view={view} workspace={open} core={core} disabled={disabled} />
						</div>
					</HeaderTitleShown.Provider>
				)}
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

/** The author's square picture: yours for you, a session's initial on its own color for a session. */
function Avatar({ by, sessions, size = "message" }: { by: BoardAuthor; sessions: KnownSessions; size?: "message" | "summary" }) {
	const box = size === "message" ? "size-9 rounded-lg text-sm" : "size-6 rounded-md text-[11px]";
	if (by.kind === "user") return <YourAvatar size={size} box={box} />;
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

/** A row under a Board task still in work, in the thread summary's style: who works on it, with shimmering text, as a Slack bot shows it is thinking. */
function WorkingLine({ sessionId, sessions, href }: { sessionId: string | null; sessions: KnownSessions; href: string }) {
	return (
		<a {...activityControl("board.task.open")} href={href} className="mt-1 -ml-[5px] flex max-w-md items-center gap-2 rounded-lg border border-transparent p-1 hover:border-border hover:bg-background">
			{sessionId ? (
				<Avatar by={{ kind: "session", sessionId }} sessions={sessions} size="summary" />
			) : (
				<span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
					<IconAiBotHead className="size-4" />
				</span>
			)}
			{sessionId ? (
				<span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
					<span className="shimmer-text shrink-0">Working on it…</span>
					<span className="truncate text-muted-foreground">{sessionLabel(sessionId, sessions).name}</span>
				</span>
			) : (
				<span className="shimmer-text text-[13px]">Starting a session…</span>
			)}
		</a>
	);
}

/** A Board task's or reply's text as Markdown, with single line breaks kept, as a Bot's message shows. */
function BoardText({ text }: { text: string }) {
	return (
		<div className="max-w-conversation min-w-0 text-sm leading-relaxed">
			<MessageMarkdown text={text} preset={BOT_MESSAGE_PRESET} />
		</div>
	);
}

/** The message's text and its labels. */
function TaskBody({ task }: { task: BoardTask }) {
	const labels = Object.entries(task.labels);
	return (
		<>
			<BoardText text={task.text || task.title} />
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

const said = (task: BoardTask): Extract<BoardReply, { by: BoardAuthor }>[] => task.replies.filter((entry): entry is Extract<BoardReply, { by: BoardAuthor }> => "by" in entry);

function TaskMessage({ state, task, sessions, open, grouped, href }: { state: BoardState; task: BoardTask; sessions: KnownSessions; open: boolean; grouped: boolean; href: string }) {
	const replies = said(task);
	const status = statusOf(state, task);
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
			<TaskBody task={task} />
			{replies.length > 0 && <ThreadSummary replies={replies} sessions={sessions} href={href} />}
			{(status.kind === "ready" || status.kind === "claimed") && <WorkingLine sessionId={session} sessions={sessions} href={href} />}
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
function Thread({ state, task, core, workspace, channel, closeHref, disabled, onChange }: { state: BoardState; task: BoardTask; core: CoreData; workspace: Workspace; channel: string; closeHref: string; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const sessions = core.sessions;
	// The thread and its reply box address the same session; a thread with none, or one not listed yet, shows only **Thread**.
	const target = wakeTarget(task, { kind: "user" });
	const name = target ? sessionLabel(target, sessions).name : null;
	const host = target ? (sessions.hosts.find(each => each.sessionId === target) ?? null) : null;
	const past = target ? (sessions.past.find(each => each.sessionId === target) ?? null) : null;
	const instanceId = host?.instanceId ?? null;
	const view = useMemo<View | null>(() => (instanceId !== null ? { kind: "live", instanceId, agentId: null } : past && target ? { kind: "past", sessionId: target } : null), [instanceId, past, target]);
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
			if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]:not([aria-label="Suggested prompts"])')) return;
			event.preventDefault();
			location.hash = closeHref;
		};
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [closeHref]);
	const label = `Thread #${task.id} in #${channel}`;
	const thread: DetailsTab<"thread"> = {
		value: "thread",
		icon: IconBubble3,
		name: "Thread",
		control: "board.thread.tab.thread",
		count: 0,
		scrollsItself: true,
		content: (
			<>
				<ThreadMessages state={state} task={task} sessions={sessions} />
				<ThreadComposer task={task} name={name} core={core} workspace={workspace} disabled={disabled} onChange={onChange} />
			</>
		),
	};
	const close = (
		<Button {...activityControl("board.thread.close")} variant="ghost" size="icon-xs" aria-label="Close thread" render={<a href={closeHref} />}>
			<IconCrossMedium />
		</Button>
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

/** The Board thread's open tabs, kept across threads. */
const THREAD_TABS = "omp-agents.board-thread-tabs";

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

/** The **Thread** tab's messages: the Board task, a line with the reply count, then the replies. The Board's notes, such as a claim or a lapsed lease, stay out: the thread shows only what was said. */
function ThreadMessages({ state, task, sessions }: { state: BoardState; task: BoardTask; sessions: KnownSessions }) {
	const status = statusOf(state, task);
	const session = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	const replies = said(task);
	const count = replies.length;
	let previous: { at: number; by: BoardAuthor } = task;
	return (
		<MessageScrollerProvider autoScroll>
			<MessageScroller className="flex-1">
				<MessageScrollerViewport>
					<MessageScrollerContent className="gap-0 py-2">
						<MessageRow by={task.by} at={task.at} sessions={sessions} grouped={false}>
							<TaskBody task={task} />
						</MessageRow>
						<div className="flex items-center gap-3 px-5 py-2 text-[13px] text-muted-foreground">
							<span className="shrink-0">{count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`}</span>
							<span className="h-px flex-1 bg-border" />
						</div>
						<ol className="flex flex-col">
							{replies.map((entry, index) => {
								const grouped = continues(previous, entry);
								previous = entry;
								return (
									<li key={index}>
										<MessageRow by={entry.by} at={entry.at} sessions={sessions} grouped={grouped}>
											<BoardText text={entry.by.kind === "session" ? splitSuggestions(entry.text).body : entry.text} />
										</MessageRow>
									</li>
								);
							})}
						</ol>
						{(status.kind === "ready" || status.kind === "claimed") && (
							<div className="px-5 pt-1">
								<WorkingLine sessionId={session} sessions={sessions} href={session ? hashForSession(session) : ""} />
							</div>
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

/** The thread's `@` menu offers sessions only, so a reply can point its session at another. */
const THREAD_MENTIONS = ["session"] as const;

/** The thread's reply box, the New session composer without its directory picker: the reply wakes the session named `name` on the model, thinking level, and skill picked here. */
function ThreadComposer({ task, name, core, workspace, disabled, onChange }: { task: BoardTask; name: string | null; core: CoreData; workspace: Workspace; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const { send } = useDashboardActions();
	const reply = ({ prompt, model, thinking, skill }: { prompt: string; model: BoardLaunch["model"]; thinking: string | null; skill: string | null }) => {
		if (!prompt || disabled) return;
		void onChange({ op: "reply", by: { kind: "user" }, task: task.id, text: prompt, launch: { model, thinking, skill } });
	};
	return (
		<div {...activityControl("board.reply")} className="shrink-0">
			<NewSession
				board={{ placeholder: name ? `Reply to ${name}…` : "Reply…", sendLabel: name ? "Send reply; it wakes the session if it stopped" : "Send reply", mentions: THREAD_MENTIONS }}
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
