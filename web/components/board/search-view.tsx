/** The Board's search, as Slack's: the header's search field with its scope chip, and the results page that shows in place of the Board tasks. */
import { IconBubble3, IconChevronDownSmall, IconCrossMedium, IconHashtag, IconMagnifyingGlass } from "central-icons";
import { type KeyboardEvent, type ReactNode, type Ref, useImperativeHandle, useRef, useState } from "react";
import { searchWords } from "../../../src/shared/every-word";
import type { Workspace } from "../../../src/shared/workspaces";
import type { BoardState } from "../../../templates/omp/agent/extensions/board/log";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import type { CoreData } from "../module-views";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute } from "./module";
import { Avatar, clock, dayLabel, folder, SessionTag } from "./page";
import { type BoardHit, type BoardScope, type BoardSearch, matchRanges, scopeOf, searchBoard, snippet } from "./search";
import { hashForBoard } from "./sidebar";

const scopeLabel = (scope: BoardScope, channel: string, thread: number | null): string => (scope === "thread" ? `thread #${thread}` : scope === "workspace" ? `#${channel}` : "all workspaces");

/** What the Board page asks of its search field: look in `scope` next, as the Board thread's magnifier does. */
export interface BoardSearchFieldHandle {
	scopeTo: (scope: BoardScope) => void;
}

interface BoardSearchFieldProps {
	/** The search the results show, if any; the field starts from it. */
	current: BoardSearch | null;
	channel: string;
	/** The open Board thread, which the thread scope searches. */
	thread: number | null;
	searchHref: (search: BoardSearch | null) => string;
	ref?: Ref<BoardSearchFieldHandle>;
}

/**
 * The header's search field, as Slack's: a scope chip, **in #workspace**, **in thread #N** while a thread is open, or
 * **in all workspaces**, then the query; Enter shows the results, Escape clears the field or closes the results.
 * While results show, a new scope searches again at once.
 */
export function BoardSearchField({ current, channel, thread, searchHref, ref }: BoardSearchFieldProps) {
	const input = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState(current?.query ?? "");
	const [picked, setPicked] = useState<BoardScope>(current?.scope ?? "workspace");
	const scope = scopeOf(picked, thread);
	const where = scopeLabel(scope, channel, thread);
	const scopeTo = (next: BoardScope) => {
		if (current) location.hash = searchHref({ query: current.query, scope: next });
		else setPicked(next);
		input.current?.focus();
	};
	useImperativeHandle(ref, () => ({ scopeTo }));
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			const query = draft.trim();
			location.hash = searchHref(query ? { query, scope } : null);
		} else if (event.key === "Escape" && (draft || current)) {
			// Taken here, so the thread's Escape does not close it as well.
			event.preventDefault();
			setDraft("");
			if (current) location.hash = searchHref(null);
			event.currentTarget.blur();
		}
	};
	return (
		<div role="search" className="flex h-7 w-80 max-w-full items-center gap-1 rounded-md bg-muted/60 pr-2 text-sm focus-within:ring-2 focus-within:ring-ring">
			<DropdownMenu>
				<DropdownMenuTrigger
					{...activityControl("board.search.scope")}
					render={<Button variant="ghost" size="compact" leadingIcon={IconMagnifyingGlass} trailingIcon={IconChevronDownSmall} aria-label={`Search scope: ${where}`} className="h-full max-w-40 min-w-0 shrink-0 text-muted-foreground" />}
				>
					{scope !== "workspace" && <span className="truncate">in {where}</span>}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="max-w-72">
					<MenuRadioGroup aria-label="Search in" value={scope} onValueChange={(value: string) => scopeTo(scopeOf(value, thread))}>
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
				ref={input}
				{...activityControl("board.search")}
				type="search"
				aria-label={`Search in ${where}`}
				placeholder="Search"
				value={draft}
				onChange={event => setDraft(event.target.value)}
				onKeyDown={onKeyDown}
				className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
			/>
		</div>
	);
}

/** `text` with every part a word covers marked, as Slack marks a search's words, in the find bar's highlight. */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
	const parts: ReactNode[] = [];
	let at = 0;
	for (const { start, end } of matchRanges(text, words)) {
		parts.push(text.slice(at, start));
		parts.push(
			<mark key={start} className="rounded-sm bg-amber-400/35 px-px text-foreground">
				{text.slice(start, end)}
			</mark>,
		);
		at = end;
	}
	parts.push(text.slice(at));
	return <>{parts}</>;
}

/** The search's results in place of the Board tasks, as Slack's results page: a line with the count and the scope, then one card per message, newest first. */
export function SearchResults({ state, route, workspace, core }: { state: BoardState; route: BoardRoute; workspace: Workspace | null; core: CoreData }) {
	const { search } = route;
	if (!search) return null;
	const open = workspace?.cwd ?? null;
	const channel = workspace ? folder(workspace.cwdDisplay) : "No workspace";
	const thread = route.thread !== null && state.tasks.some(task => task.id === route.thread && task.workspace === open) ? route.thread : null;
	const { query } = search;
	const scope = scopeOf(search.scope, thread);
	const hits = searchBoard(state, search, open, thread);
	const words = searchWords(query);
	const searchHref = (next: BoardSearch | null) => hashForBoard(open, route.thread, { search: next });
	const workspaceName = (cwd: string): string => folder(core.workspaces.find(each => each.cwd === cwd)?.cwdDisplay ?? cwd);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-2">
				<h3 aria-live="polite" className="min-w-0 flex-1 truncate text-sm">
					<span className="font-semibold">
						{hits.length} {hits.length === 1 ? "result" : "results"}
					</span>{" "}
					for “{query}” <span className="text-muted-foreground">in {scopeLabel(scope, channel, thread)}</span>
				</h3>
				<Tooltip content="Close search">
					<Button {...activityControl("board.search.clear")} variant="ghost" size="icon-xs" aria-label="Close search" render={<a href={searchHref(null)} />}>
						<IconCrossMedium />
					</Button>
				</Tooltip>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-4">
				{hits.length === 0 ? (
					<Empty className="py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconMagnifyingGlass />
							</EmptyMedia>
							<EmptyTitle>No results for “{query}”</EmptyTitle>
							<EmptyDescription>Check the spelling or try fewer words{scope === "all" ? "." : ", or search every workspace."}</EmptyDescription>
						</EmptyHeader>
						{scope !== "all" && (
							<Button {...activityControl("board.search.all")} variant="outline" size="compact" render={<a href={searchHref({ query, scope: "all" })} />}>
								Search all workspaces
							</Button>
						)}
					</Empty>
				) : (
					<ol aria-label="Search results" className="flex flex-col gap-2 px-5">
						{hits.map(hit => (
							<li key={`${hit.task.id}:${hit.reply ?? "task"}`}>
								<SearchResult hit={hit} query={query} words={words} sessions={core.sessions} workspace={scope === "all" ? workspaceName(hit.task.workspace) : null} />
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	);
}

/** One result card, as Slack's: the workspace and the Board task it sits in with its day, then the author, time, and the text with the query's words marked; a click opens it in its thread. */
function SearchResult({ hit, query, words, sessions, workspace }: { hit: BoardHit; query: string; words: readonly string[]; sessions: KnownSessions; workspace: string | null }) {
	const { task, reply, by, at } = hit;
	return (
		<a
			{...activityControl("board.search.result")}
			href={hashForBoard(task.workspace, task.id, { reply })}
			className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
				{workspace !== null && (
					<>
						<IconHashtag aria-hidden className="size-3 shrink-0" />
						<span className="shrink-0 font-semibold text-foreground">{workspace}</span>
						<span aria-hidden>·</span>
					</>
				)}
				<span className="min-w-0 truncate">{reply === null ? `#${task.id}` : `Reply in thread #${task.id}: ${task.title}`}</span>
				<span className="ml-auto shrink-0 pl-2">{dayLabel(at)}</span>
			</span>
			<span className="flex gap-2">
				<Avatar by={by} sessions={sessions} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="truncate text-sm font-bold">{by.kind === "user" ? "You" : sessionLabel(by.sessionId, sessions).name}</span>
						{by.kind === "session" && <SessionTag />}
						<time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
							{clock(at)}
						</time>
					</span>
					<span className="line-clamp-3 text-sm leading-relaxed break-words">
						<Marked text={snippet(hit.text, query)} words={words} />
					</span>
				</span>
			</span>
		</a>
	);
}
