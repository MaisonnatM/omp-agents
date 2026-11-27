/**
 * The Board page, laid out as a Slack channel: the open Workspace's Board tasks as messages, grouped by author and
 * split by day, each with its thread summary and a hover toolbar, over the composer that posts one; the open Board
 * task's Board thread at the right, as Slack's thread pane. The header's search field, as Slack's, shows its results in
 * place of the Board tasks. The sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import { IconAiBotHead, IconArrowUpRight, IconBubble3, IconChevronRightSmall, IconCrossMedium, IconHashtag, IconMagnifyingGlass } from "central-icons";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { PastSession, PromptImage, RosterHost, View } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Header, HeaderTitleShown } from "../page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { CountPill } from "../count-pill";
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardReply, type BoardState, type BoardTask, MAX_TITLE, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { splitSuggestions } from "../../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { MessageScroller, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { putJson } from "../../api";
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
import { type KnownSessions, sessionLabel } from "../../labels";
import type { BoardRoute, BoardView } from "./module";
import { boardTabsOn, ChannelTabs, WorkspaceTab } from "./tabs";
import { boardWorkspaces, hashForBoard, revealSessionTab, revealThreadTab, THREAD_TABS } from "./sidebar";
import { replyText } from "./search";
import { BoardSearchField, type BoardSearchFieldHandle, SearchResults } from "./search-view";
import { boardActions, SessionActions } from "./actions";
import { BoardNoteLine, isThreadNote } from "./board-note";
import { RoutineIds } from "./routine-author";
import { threadSession, type Work, workOf } from "./work";
import { authorKey, BoardText, CloseTaskButton, continues, DayDivider, EditButton, folder, MarkUnreadButton, MessageEditor, MessageRow, sameDay, TaskBody, WorkingLine, WorkLabel, Avatar } from "./messages";
import { markSeen, said, unreadOf, useSeen } from "./seen";
import { ChannelUnreadPills, taskItemId, ThreadNewReplies } from "./unread-jump";

interface BoardPageProps {
	route: BoardRoute;
	core: CoreData;
	state: BoardState | null;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function BoardPage(props: BoardPageProps) {
	return (
		<RoutineIds routines={props.core.routines}>
			<BoardChannel {...props} />
		</RoutineIds>
	);
}

function BoardChannel({ route, core, state, disabled, onChange }: BoardPageProps) {
	useMinute();
	const [off] = useModulesOff();
	const searchField = useRef<BoardSearchFieldHandle>(null);
	if (state === null) return <BoardLoading />;
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
														<MessageScrollerItem messageId={taskItemId(task.id)}>
															<TaskMessage state={state} task={task} sessions={core.sessions} open={task.id === thread?.id} grouped={!!previous && continues(previous, task)} href={hashForBoard(open, task.id)} disabled={disabled} onChange={onChange} />
														</MessageScrollerItem>
													</li>
												);
											})}
										</ol>
									</MessageScrollerContent>
								</MessageScrollerViewport>
								<ChannelUnreadPills tasks={tasks} open={thread?.id ?? null} />
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
					session={route.session}
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

/** The channel's stand-in while the Board loads: three message rows of avatar and text bars. */
function BoardLoading() {
	return (
		<div role="status" className="flex min-h-0 flex-1 flex-col justify-end gap-5 px-6 py-6">
			<span className="sr-only">Loading the Board</span>
			{[280, 420, 340].map(width => (
				<div key={width} className="flex gap-2">
					<span aria-hidden className="size-9 shrink-0 rounded-lg bg-muted" />
					<div className="flex flex-col gap-2 pt-1">
						<Skeleton width={96} />
						<Skeleton width={width} />
					</div>
				</div>
			))}
		</div>
	);
}

function ChannelIntro({ name }: { name: string }) {
	return (
		<div className="flex flex-col gap-1 px-6 pb-4">
			<h2 className="flex items-center gap-1 text-lg font-semibold">
				<IconHashtag aria-hidden className="size-5 text-muted-foreground" />
				{name}
			</h2>
			<p className="text-sm text-muted-foreground">Each message here becomes a Board task, and a session starts working on it.</p>
		</div>
	);
}

function TaskMessage({ state, task, sessions, open, grouped, href, disabled, onChange }: { state: BoardState; task: BoardTask; sessions: KnownSessions; open: boolean; grouped: boolean; href: string; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const replies = said(task);
	const seenMap = useSeen();
	const work = workOf(state, task, sessions.hosts);
	const session = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	const [editing, setEditing] = useState(false);
	const unread = open ? 0 : unreadOf(task, seenMap[task.id]);
	const toolbar = (
		<>
			{task.by.kind === "user" && !editing && <EditButton disabled={disabled} onEdit={() => setEditing(true)} />}
			{task.doneAt === null && <CloseTaskButton task={task} disabled={disabled} onChange={onChange} />}
			<Tooltip content="Reply in thread">
				<Button {...activityControl("board.task.open")} variant="ghost" size="icon-xs" aria-label={`Reply in thread #${task.id}`} render={<a href={href} />}>
					<IconBubble3 />
				</Button>
			</Tooltip>
			{session && (
				<Tooltip content="Open its session">
					<Button {...activityControl("board.session.open")} variant="ghost" size="icon-xs" aria-label="Open its session" render={<a href={hashForBoard(task.workspace, task.id, { session })} onClick={revealSessionTab} />}>
						<IconArrowUpRight />
					</Button>
				</Tooltip>
			)}
			{!open && unreadOf(task, 0) > 0 && <MarkUnreadButton onMark={() => markSeen(task.id, 0)} />}
		</>
	);
	return (
		<MessageRow by={task.by} at={task.at} sessions={sessions} state={state} workspace={task.workspace} grouped={grouped} highlighted={open} unread={unread > 0} toolbar={toolbar}>
			<TaskBody short task={task} editor={editing ? <MessageEditor text={task.text || task.title} onSave={text => onChange({ op: "edit", by: { kind: "user" }, task: task.id, text })} onClose={() => setEditing(false)} /> : undefined} />
			{replies.length > 0 ? (
				<ThreadSummary replies={replies} unread={unread} work={work} sessions={sessions} href={href} />
			) : (
				work && <WorkingLine work={work} sessions={sessions} href={href} />
			)}
		</MessageRow>
	);
}

/** Who replied, how many replies, and when the last came, or while a session works on it how it stands in that place, which opens the thread, as under a Slack message. */
function ThreadSummary({ replies, unread, work, sessions, href }: { replies: Extract<BoardReply, { by: BoardAuthor }>[]; unread: number; work: Work | null; sessions: KnownSessions; href: string }) {
	const worker: BoardAuthor[] = work && (work.kind === "working" || work.kind === "waiting") ? [{ kind: "session", sessionId: work.sessionId }] : [];
	// Every session draws the same omp mark, so all sessions count as one avatar.
	const authors = [...new Map([...worker, ...replies.map(reply => reply.by)].map(by => [by.kind === "session" ? "session" : authorKey(by), by])).values()].slice(0, 5);
	const last = replies.at(-1);
	return (
		<a
			{...activityControl("board.task.open")}
			href={href}
			onClick={revealThreadTab}
			className="group/summary mt-1 -ml-1 flex w-fit max-w-full items-center gap-2 rounded-lg p-1 pr-2 ring-1 ring-transparent ring-inset hover:bg-background hover:ring-border"
		>
			<span className="flex gap-0.5">
				{authors.map(by => (
					<Avatar key={authorKey(by)} by={by} sessions={sessions} size="summary" />
				))}
			</span>
			<span className="text-xs font-semibold whitespace-nowrap text-foreground">
				{replies.length} {replies.length === 1 ? "reply" : "replies"}
			</span>
			{unread > 0 && (
				<span aria-label={`${unread} unread`} className="flex">
					<CountPill count={unread} />
				</span>
			)}
			{work ? (
				<span className="min-w-0">
					<WorkLabel work={work} detail={null} />
				</span>
			) : (
				last && (
					<span className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground">
						Last reply <Age at={last.at} className="tabular-nums" /> ago
					</span>
				)
			)}
			<IconChevronRightSmall aria-hidden className="-ml-1 size-4 shrink-0 text-muted-foreground opacity-0 group-hover/summary:opacity-100" />
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
				board={{ placeholder: `Message ${folder(workspace.cwdDisplay)} to start a session`, sendLabel: "Post and start a session" }}
				cwd={workspace.cwd}
				workspaces={core.workspaces}
				launch={null}
				connected={!disabled}
				completions={core.newSessionCompletions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd: workspace.cwd }, text, cursor })}
				onPickCwd={cwd => (location.hash = hashForBoard(cwd))}
				onStart={post}
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
function Thread({ state, task, reply, session, core, workspace, channel, closeHref, onSearch, disabled, onChange }: { state: BoardState; task: BoardTask; reply: number | null; session: string | null; core: CoreData; workspace: Workspace; channel: string; closeHref: string; onSearch: () => void; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const sessions = core.sessions;
	const replyCount = said(task).length;
	useEffect(() => markSeen(task.id, replyCount), [task.id, replyCount]);
	// The thread shows the session the address picked, else the one a reply wakes, or on a done Board task the last one that worked on it; a thread with none, or one not listed yet, shows only **Thread**.
	const target = threadSession(task, session);
	const name = target ? sessionLabel(target, sessions).name : null;
	// The reply box names the session a reply wakes, which may not be the one the tabs show.
	const woken = wakeTarget(task, { kind: "user" });
	const wokenName = woken ? sessionLabel(woken, sessions).name : null;
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
				<ThreadComposer task={task} failed={workOf(state, task, sessions.hosts)?.kind === "failed"} name={wokenName} core={core} workspace={workspace} disabled={disabled} onChange={onChange} onSend={() => setSentOn(reply)} />
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

/** The **Thread** tab's messages: the Board task, a line with the reply count, then the replies, with reply `reply` (an index of `task.replies`) highlighted, and a working line while the task runs; each reply's **Mark unread** passes how many replies come before it. Of the Board's notes only those `isThreadNote` picks show, between the replies: the merges it ran, a session that did not start, and your closing it. */
function ThreadMessages({ state, task, reply, follow, sessions, disabled, onChange, onMarkUnread, children }: { state: BoardState; task: BoardTask; reply: number | null; follow: boolean; sessions: KnownSessions; disabled: boolean; onChange: (change: BoardChange) => Promise<void>; onMarkUnread: (from: number) => void; children: ReactNode }) {
	const work = workOf(state, task, sessions.hosts);
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
							toolbar={
								editing === "task" ? undefined : (
									<>
										{task.by.kind === "user" && <EditButton disabled={disabled} onEdit={() => setEditing("task")} />}
										{task.doneAt === null && <CloseTaskButton task={task} disabled={disabled} onChange={onChange} />}
									</>
								)
							}
						>
							<TaskBody task={task} editor={editing === "task" ? editor(task.text || task.title) : undefined} />
						</MessageRow>
						<div className="flex items-center gap-3 px-5 py-2 text-[13px] text-muted-foreground">
							<span className="shrink-0">{count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`}</span>
							<span className="h-px flex-1 bg-border" />
						</div>
						<ol className="flex flex-col">
							{task.replies.map((entry, index) => {
								if ("note" in entry)
									return isThreadNote(entry.note) ? (
										<li key={index}>
											<BoardNoteLine note={entry.note} />
										</li>
									) : null;
								const position = replies.indexOf(entry);
								const grouped = continues(previous, entry);
								previous = entry;
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
				<ThreadNewReplies task={task} />
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

/** The thread's reply box, the New session composer without its directory picker: the reply wakes the session named `name`, or on a done Board task, or one whose session `failed` to start, starts a new one, on the model, thinking level, and skill picked here. A done Board task's session's suggested prompts list under its action bar; each sends itself as the user's reply. */
function ThreadComposer({ task, failed, name, core, workspace, disabled, onChange, onSend }: { task: BoardTask; failed: boolean; name: string | null; core: CoreData; workspace: Workspace; disabled: boolean; onChange: (change: BoardChange) => Promise<void>; onSend: () => void }) {
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
					placeholder: task.doneAt !== null ? "Reply to start a new session on it…" : failed ? "Reply to try again…" : name ? `Reply to ${name}…` : "Reply…",
					sendLabel: task.doneAt !== null ? "Send reply; a new session takes it from the thread" : failed ? "Send reply; a new session starts on it" : name ? "Send reply; it wakes the session if it stopped" : "Send reply",
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
				projectId={null}
				draftKey={boardThreadDraftKey(task.id)}
			/>
		</div>
	);
}
