/**
 * The Board page, laid out as a Slack channel: the open Workspace's Board tasks as messages, grouped by author and
 * split by day, each with its thread summary and a hover toolbar, over the composer that posts one; the open Board
 * task's Board thread at the right, as Slack's thread pane. The header's search field, as Slack's, shows its results in
 * place of the Board tasks. The sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import * as TabsPrimitive from "@ui-sdk/react/tabs";
import { IconAiBotHead, IconArrowUpRight, IconBubble3, IconChevronDownSmall, IconCrossMedium, IconHashtag, IconMagnifyingGlass, IconUser } from "central-icons";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { hashForSession, type View } from "../../../src/shared/sessions";
import { splitSuggestions } from "../../../src/shared/transcript";
import type { Workspace } from "../../../src/shared/workspaces";
import { Header } from "../page-header";
import { BOT_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardNote, type BoardReply, type BoardState, type BoardStatus, type BoardTask, MAX_TITLE, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/lib/icon-context";
import { getJson } from "../../api";
import { useShowConversation } from "../../pane-store";
import { UNREAD } from "../../reads";
import { activityControl } from "../../activity";
import { boardDraftKey, boardThreadDraftKey } from "../../composer-drafts";
import { useStoredState } from "../../stored-state";
import { useMinute } from "../../use-minute";
import { Age } from "../age";
import { ClosableTab } from "../closable-tab";
import { Separator, useDragSeparator } from "../drag-separator";
import { useDashboardActions } from "../dashboard-context";
import type { CoreData } from "../module-views";
import { NewSession } from "../new-session";
import { ViewConversation } from "../pane";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardControlId, BoardRoute } from "./module";
import { boardWorkspaces, hashForBoard } from "./sidebar";
import { type BoardHit, type BoardScope, type BoardSearch, matchRanges, replyText, searchBoard, snippet, termsOf } from "./search";

interface BoardPageProps {
	route: BoardRoute;
	core: CoreData;
	state: BoardState | null;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function BoardPage({ route, core, state, disabled, onChange }: BoardPageProps) {
	useMinute();
	const searchField = useRef<HTMLInputElement>(null);
	const [scope, setScope] = useState<BoardScope>(route.search?.scope ?? "workspace");
	const routeScope = route.search?.scope;
	useEffect(() => {
		if (routeScope) setScope(routeScope);
	}, [routeScope]);
	if (state === null) return <p className="px-6 py-6 text-sm text-muted-foreground">Loading the Board…</p>;
	const { open: openWorkspace } = boardWorkspaces(state, core.workspaces, core.workspace, route);
	const open = openWorkspace?.cwd ?? null;
	const name = openWorkspace ? folder(openWorkspace.cwdDisplay) : "No workspace";
	const tasks = state.tasks.filter(task => task.workspace === open);
	const thread = route.thread === null ? null : (tasks.find(task => task.id === route.thread) ?? null);
	const shownScope: BoardScope = scope === "thread" && thread === null ? "workspace" : scope;
	const searchInThread = () => {
		setScope("thread");
		searchField.current?.focus();
	};
	return (
		<div className="flex h-full min-h-0 flex-1">
			<section aria-label="Board" className="flex min-w-[360px] flex-1 flex-col">
				<Header leading={<IconHashtag aria-hidden className="size-4 shrink-0 text-muted-foreground" />} title={name}>
					{openWorkspace && (
						<SearchField
							key={route.search?.query ?? ""}
							inputRef={searchField}
							initial={route.search?.query ?? ""}
							scope={shownScope}
							onScope={setScope}
							channel={name}
							thread={thread?.id ?? null}
							searchHref={search => hashForBoard(open, route.thread, { search })}
						/>
					)}
				</Header>
				{route.search ? (
					<SearchResults
						search={{ query: route.search.query, scope: route.search.scope }}
						hits={searchBoard(state, route.search, open, thread?.id ?? null)}
						core={core}
						channel={name}
						thread={thread?.id ?? null}
						searchHref={search => hashForBoard(open, route.thread, { search })}
					/>
				) : (
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
					</>
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
					onSearch={searchInThread}
					disabled={disabled}
					onChange={onChange}
				/>
			)}
		</div>
	);
}

const scopeLabel = (scope: BoardScope, channel: string, thread: number | null): string => (scope === "thread" ? `thread #${thread}` : scope === "workspace" ? `#${channel}` : "all workspaces");

/**
 * The header's search field, as Slack's: a scope chip, **in #workspace**, **in thread #N** while a thread is open, or
 * **in all workspaces**, then the query; Enter shows the results, Escape clears the field or closes the results.
 */
function SearchField({ inputRef, initial, scope, onScope, channel, thread, searchHref }: { inputRef: RefObject<HTMLInputElement | null>; initial: string; scope: BoardScope; onScope: (scope: BoardScope) => void; channel: string; thread: number | null; searchHref: (search: BoardSearch | null) => string }) {
	const [draft, setDraft] = useState(initial);
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			const query = draft.trim();
			location.hash = searchHref(query ? { query, scope } : null);
		} else if (event.key === "Escape" && (draft || initial)) {
			// Taken here, so the thread's Escape does not close it as well.
			event.preventDefault();
			setDraft("");
			if (initial) location.hash = searchHref(null);
			event.currentTarget.blur();
		}
	};
	return (
		<div role="search" className="flex h-8 w-80 max-w-full items-center gap-1 rounded-lg border border-border bg-muted/60 pr-2 pl-1 focus-within:border-ring focus-within:bg-background">
			<DropdownMenu>
				<DropdownMenuTrigger
					{...activityControl("board.search.scope")}
					render={<Button variant="ghost" size="compact" leadingIcon={IconMagnifyingGlass} trailingIcon={IconChevronDownSmall} aria-label={`Search in ${scopeLabel(scope, channel, thread)}`} className="max-w-40 min-w-0 shrink-0 text-muted-foreground" />}
				>
					<span className="truncate">in {scopeLabel(scope, channel, thread)}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="max-w-72">
					<MenuRadioGroup
						aria-label="Search in"
						value={scope}
						onValueChange={(value: string) => {
							onScope(value === "thread" || value === "all" ? value : "workspace");
							inputRef.current?.focus();
						}}
					>
						{thread !== null && (
							<MenuRadioItem value="thread" closeOnSelect>
								<IconBubble3 />
								This thread, #{thread}
							</MenuRadioItem>
						)}
						<MenuRadioItem value="workspace" closeOnSelect>
							<IconHashtag />
							<span className="truncate">{channel}</span>
						</MenuRadioItem>
						<MenuRadioItem value="all" closeOnSelect>
							<IconMagnifyingGlass />
							All workspaces
						</MenuRadioItem>
					</MenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<input
				ref={inputRef}
				{...activityControl("board.search")}
				type="search"
				aria-label={`Search in ${scopeLabel(scope, channel, thread)}`}
				placeholder="Search"
				value={draft}
				onChange={event => setDraft(event.target.value)}
				onKeyDown={onKeyDown}
				className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
			/>
		</div>
	);
}

/** `text` with every part a term covers marked, as Slack marks a search's words. */
function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
	const parts: ReactNode[] = [];
	let at = 0;
	for (const { start, end } of matchRanges(text, terms)) {
		parts.push(text.slice(at, start));
		parts.push(
			<mark key={start} className="rounded-sm bg-amber-200 px-px text-foreground dark:bg-amber-400/35">
				{text.slice(start, end)}
			</mark>,
		);
		at = end;
	}
	parts.push(text.slice(at));
	return <>{parts}</>;
}

/** The search's results in place of the Board tasks, as Slack's results page: a line with the count and the scope, then one card per message, newest first. */
function SearchResults({ search, hits, core, channel, thread, searchHref }: { search: BoardSearch; hits: BoardHit[]; core: CoreData; channel: string; thread: number | null; searchHref: (search: BoardSearch | null) => string }) {
	const terms = termsOf(search.query);
	const where = scopeLabel(search.scope, channel, thread);
	const workspaceName = (cwd: string): string => folder(core.workspaces.find(each => each.cwd === cwd)?.cwdDisplay ?? cwd);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-2">
				<h3 className="min-w-0 flex-1 truncate text-sm">
					<span className="font-semibold">
						{hits.length} {hits.length === 1 ? "result" : "results"}
					</span>{" "}
					for “{search.query}” <span className="text-muted-foreground">in {where}</span>
				</h3>
				<Tooltip content="Close search">
					<Button {...activityControl("board.search.clear")} variant="ghost" size="icon-xs" aria-label="Close search" render={<a href={searchHref(null)} />}>
						<IconCrossMedium />
					</Button>
				</Tooltip>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-4">
				{hits.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
						<IconMagnifyingGlass aria-hidden className="size-6 text-muted-foreground" />
						<p className="text-sm font-semibold">No results for “{search.query}”</p>
						<p className="max-w-sm text-sm text-muted-foreground">Check the spelling or try fewer words{search.scope === "all" ? "." : ", or search every workspace."}</p>
						{search.scope !== "all" && (
							<Button variant="outline" size="compact" render={<a href={searchHref({ query: search.query, scope: "all" })} />}>
								Search all workspaces
							</Button>
						)}
					</div>
				) : (
					<ol aria-label="Search results" className="flex flex-col gap-2 px-5">
						{hits.map(hit => (
							<li key={`${hit.task.id}:${hit.reply ?? "task"}`}>
								<SearchResult hit={hit} terms={terms} sessions={core.sessions} workspace={workspaceName(hit.task.workspace)} />
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	);
}

/** One result card, as Slack's: the workspace and the Board task it sits in with its day, then the author, time, and the text with the query's words marked; a click opens it in its thread. */
function SearchResult({ hit, terms, sessions, workspace }: { hit: BoardHit; terms: readonly string[]; sessions: KnownSessions; workspace: string }) {
	const { task, reply, by, at } = hit;
	return (
		<a
			{...activityControl("board.search.result")}
			href={hashForBoard(task.workspace, task.id, { reply })}
			className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
		>
			<span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
				<IconHashtag aria-hidden className="size-3 shrink-0" />
				<span className="shrink-0 font-semibold text-foreground">{workspace}</span>
				<span aria-hidden>·</span>
				<span className="min-w-0 truncate">{reply === null ? `#${task.id}` : `Reply in thread #${task.id}: ${task.title}`}</span>
				<span className="ml-auto shrink-0 pl-2">{dayLabel(at)}</span>
			</span>
			<span className="flex gap-2">
				<Avatar by={by} sessions={sessions} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="truncate text-sm font-bold">{by.kind === "user" ? "You" : sessionLabel(by.sessionId, sessions).name}</span>
						{by.kind === "session" && <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Session</span>}
						<time dateTime={new Date(at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
							{clock(at)}
						</time>
					</span>
					<span className="line-clamp-3 text-sm leading-relaxed break-words">
						<Marked text={snippet(hit.text, terms)} terms={terms} />
					</span>
				</span>
			</span>
		</a>
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

type ThreadTabValue = "thread" | "session";

/** The Board thread as Slack's thread pane, at the width you drag its left edge to, under a row of tabs as the session details sidebar draws them: **Thread**, the Board task, a line with the reply count, the replies and the Board's grey lines, and the reply box; and **Session**, the conversation of the session its replies wake. Escape closes it. */
function Thread({ state, task, reply, core, workspace, channel, closeHref, onSearch, disabled, onChange }: { state: BoardState; task: BoardTask; reply: number | null; core: CoreData; workspace: Workspace; channel: string; closeHref: string; onSearch: () => void; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const sessions = core.sessions;
	const [tab, setTab] = useState<ThreadTabValue>("thread");
	// The thread and its reply box address the same session; a thread with none shows only **Thread**.
	const target = wakeTarget(task, { kind: "user" });
	const name = target ? sessionLabel(target, sessions).name : null;
	const shown: ThreadTabValue = target ? tab : "thread";
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
	return (
		<aside aria-label={`Thread #${task.id}`} style={{ width }} className="relative flex max-w-[calc(100%-360px)] shrink-0 flex-col border-l border-border">
			<Separator {...resize} axis="vertical" label="Resize the thread" min={MIN_THREAD} max={MAX_THREAD} now={width} className="inset-y-0 -left-1.5 w-3 cursor-col-resize select-none" />
			<TabsPrimitive.Tabs value={shown} onValueChange={value => setTab(value === "session" ? "session" : "thread")} className="flex min-h-0 flex-1 flex-col">
				{/* Content-box, so the hairline sits under the full header height, level with the Board header's. */}
				<header className="box-content flex h-(--page-header-height) shrink-0 items-center gap-1 border-b border-border px-2">
					<h2 className="sr-only">Thread #{task.id} in #{channel}</h2>
					<TabsPrimitive.TabsList aria-label="Thread views" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
						<ThreadTab value="thread" icon={IconBubble3} name="Thread" active={shown === "thread"} control="board.thread.tab.thread" />
						{target && name && <ThreadTab value="session" icon={IconAiBotHead} name={name} active={shown === "session"} control="board.thread.tab.session" />}
					</TabsPrimitive.TabsList>
					<Tooltip content="Search in thread">
						<Button {...activityControl("board.thread.search")} variant="ghost" size="icon-xs" aria-label="Search in thread" onClick={onSearch}>
							<IconMagnifyingGlass />
						</Button>
					</Tooltip>
					<Button {...activityControl("board.thread.close")} variant="ghost" size="icon-xs" aria-label="Close thread" render={<a href={closeHref} />}>
						<IconCrossMedium />
					</Button>
				</header>
				<TabsPrimitive.TabsPanel value="thread" className="flex min-h-0 flex-1 flex-col outline-none">
					<ThreadMessages state={state} task={task} reply={reply} sessions={sessions} />
					<ThreadComposer task={task} name={name} core={core} workspace={workspace} disabled={disabled} onChange={onChange} />
				</TabsPrimitive.TabsPanel>
				{target && (
					<TabsPrimitive.TabsPanel value="session" className="relative flex min-h-0 flex-1 flex-col outline-none">
						<SessionTab sessionId={target} core={core} />
					</TabsPrimitive.TabsPanel>
				)}
			</TabsPrimitive.Tabs>
		</aside>
	);
}

/** One of the thread's tabs, drawn as the session details sidebar draws its first tab, which stays open; the row scrolls when they overflow. */
function ThreadTab({ value, icon: Icon, name, active, control }: { value: ThreadTabValue; icon: IconComponent; name: string; active: boolean; control: BoardControlId }) {
	return (
		<ClosableTab name={name} active={active} onClose={null} closeControl="details.tab.close" activePadding="pr-2.5" className={cn("min-w-0 shrink-0", active && "bg-active text-foreground")}>
			{body => (
				<TabsPrimitive.TabsTab value={value} {...activityControl(control)} title={name} className={body}>
					<Icon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="truncate">{name}</span>
				</TabsPrimitive.TabsTab>
			)}
		</ClosableTab>
	);
}

/** The **Session** tab: the conversation of the session the Board task's replies wake, live with its composer, or saved and read-only, where the Thread tab's reply wakes it. */
function SessionTab({ sessionId, core }: { sessionId: string; core: CoreData }) {
	const host = core.sessions.hosts.find(each => each.sessionId === sessionId) ?? null;
	const past = core.sessions.past.find(each => each.sessionId === sessionId) ?? null;
	const instanceId = host?.instanceId ?? null;
	const view = useMemo<View | null>(() => (instanceId !== null ? { kind: "live", instanceId, agentId: null } : past ? { kind: "past", sessionId } : null), [instanceId, past, sessionId]);
	useShowConversation(view);
	if (view === null) return <p className="px-5 py-6 text-sm text-muted-foreground">This session's conversation isn't listed yet.</p>;
	return <ViewConversation view={view} focused={false} host={host} lastHost={null} session={past} models={(instanceId !== null && core.models.get(instanceId)) || UNREAD} workspaces={core.workspaces} header={false} />;
}

/** The **Thread** tab's messages: the Board task, a line with the reply count, then the replies and the Board's grey lines. */
function ThreadMessages({ state, task, reply, sessions }: { state: BoardState; task: BoardTask; reply: number | null; sessions: KnownSessions }) {
	const count = said(task).length;
	// A search result opens its reply highlighted, scrolled to the middle once the scroller has settled at the bottom.
	const found = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (reply === null) return;
		const frame = requestAnimationFrame(() => found.current?.scrollIntoView({ block: "center" }));
		return () => cancelAnimationFrame(frame);
	}, [reply]);
	// A grey line ends a run of messages, so the reply after it shows its avatar and name again.
	let previous: { at: number; by: BoardAuthor } | null = task;
	return (
		<MessageScrollerProvider autoScroll>
			<MessageScroller className="flex-1">
				<MessageScrollerViewport>
					<MessageScrollerContent className="gap-0 py-2">
						<MessageRow by={task.by} at={task.at} sessions={sessions} grouped={false}>
							<TaskBody state={state} task={task} sessions={sessions} />
						</MessageRow>
						<div className="flex items-center gap-3 px-5 py-2 text-[13px] text-muted-foreground">
							<span className="shrink-0">{count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`}</span>
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
									<li key={index} ref={index === reply ? found : undefined}>
										<MessageRow by={entry.by} at={entry.at} sessions={sessions} grouped={grouped} highlighted={index === reply}>
											<BoardText text={replyText(entry.by, entry.text)} />
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
	);
}

/** The thread's reply box, the New session composer without its directory picker: the reply wakes the session named `name` on the model, thinking level, and skill picked here, and the prompts a session's last reply suggests list under it. */
function ThreadComposer({ task, name, core, workspace, disabled, onChange }: { task: BoardTask; name: string | null; core: CoreData; workspace: Workspace; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const { send } = useDashboardActions();
	const last = said(task).at(-1);
	const suggestions = last?.by.kind === "session" ? splitSuggestions(last.text).suggestions : [];
	const reply = ({ prompt, model, thinking, skill }: { prompt: string; model: BoardLaunch["model"]; thinking: string | null; skill: string | null }) => {
		if (!prompt || disabled) return;
		void onChange({ op: "reply", by: { kind: "user" }, task: task.id, text: prompt, launch: { model, thinking, skill } });
	};
	return (
		<div {...activityControl("board.reply")} className="shrink-0">
			<NewSession
				board={{ placeholder: name ? `Reply to ${name}…` : "Reply…", sendLabel: name ? "Send reply; it wakes the session if it stopped" : "Send reply", suggestions }}
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
