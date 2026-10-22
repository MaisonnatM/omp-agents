import { ArrowDownUp, ChevronDown, CircleCheck, ExternalLink, FileCode2, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, ThumbsUp } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { type Person, type PullRequestComment, type PullRequestCommit, type PullRequestDetail, type PullRequestEvent, type PullRequestThread, prKey, type ReactionContent } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import { approvalCount, timelineRows, type TimelineRow, type Verdict } from "../../pull-request-timeline";
import { commentCount } from "../../pull-requests-model";
import { Markdown } from "../sheet-details";
import { Avatar } from "./avatars";
import type { Placement } from "./pr-details";
import { REVIEW_STYLE, ThreadPlace } from "./pr-details/message";

const ROW_CLASS = "relative mb-5 pl-12 [contain-intrinsic-block-size:48px] [content-visibility:auto]";
const FOCUS_CLASS = "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function RelativeTime({ at }: { at: number }) {
	return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{age(at)} ago</time>;
}

function Marker({ author, children, muted = false, top = false }: { author?: Person | null; children?: ReactNode; muted?: boolean; top?: boolean }) {
	return (
		<span aria-hidden className={cn("absolute left-0 z-1 flex size-8 -translate-y-1/2 items-center justify-center bg-background", top ? "top-6" : "top-1/2")}>
			{author ? <Avatar person={author} label={author.login} className={cn("size-7 bg-muted text-3xs ring-0", muted && "opacity-45 grayscale")} /> : <span className="flex size-7 items-center justify-center text-muted-foreground">{children}</span>}
		</span>
	);
}

const REACTION_EMOJI: Record<ReactionContent, string> = { THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀" };

function Reactions({ comment }: { comment: PullRequestComment }) {
	return (
		<div className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
			{comment.reactions.map(reaction => (
				<span key={reaction.content} title={`${reaction.content.toLowerCase().replaceAll("_", " ")}${reaction.viewerHasReacted ? " · You reacted" : ""}`} className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs", reaction.viewerHasReacted ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/70 bg-muted/40 text-muted-foreground")}>
					<span>{REACTION_EMOJI[reaction.content]}</span>
					<span className="tabular-nums">{reaction.count}</span>
				</span>
			))}
		</div>
	);
}

function HostLink({ url }: { url: string | null }) {
	return url ? <a href={url} target="_blank" rel="noreferrer" aria-label="Open activity on GitHub" className={cn("flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground", FOCUS_CLASS)}><ExternalLink aria-hidden className="size-3" /></a> : null;
}

function ConversationCard({ comment, action = "commented" }: { comment: PullRequestComment; action?: string }) {
	return (
		<article className="py-2">
			<div className="flex min-w-0 flex-wrap items-start gap-2 px-2">
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
						<span className="font-semibold text-foreground">{comment.author.login}</span>
						<span className="text-muted-foreground">{action}</span>
					</p>
					<div className="mt-1 text-2xs text-muted-foreground"><RelativeTime at={comment.at} /></div>
				</div>
				<Reactions comment={comment} />
				<HostLink url={comment.url} />
			</div>
			{comment.body.trim() && <div className="mt-3 px-2 pb-2"><Markdown text={comment.body} /></div>}
		</article>
	);
}

function ConversationGroup({ events }: { events: [PullRequestEvent, ...PullRequestEvent[]] }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const authors = new Set(events.map(event => event.author.login));
	const [first] = events;
	return (
		<li className={ROW_CLASS}>
			<Marker author={first.author} muted={!open} top />
			<button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className={cn("flex w-full min-w-0 items-center gap-3 py-2 text-left hover:opacity-100", FOCUS_CLASS, open ? "text-foreground" : "text-muted-foreground opacity-55")}>
				<span className="min-w-0 flex-1">
					<span className="block text-xs font-semibold">{events.length} {events.length === 1 ? "comment" : "comments"}</span>
					<span className="block truncate text-3xs text-muted-foreground">{authors.size} {authors.size === 1 ? "author" : "authors"} · <RelativeTime at={first.at} /></span>
				</span>
				<ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />
			</button>
			<div id={id} hidden={!open} className="mt-1 space-y-1">
				{open && events.map((event, index) => <ConversationCard key={event.url ?? index} comment={event} action={event.review ? "reviewed" : "commented"} />)}
			</div>
		</li>
	);
}

function Thread({ detail, thread, root, replies }: { detail: PullRequestDetail; thread: PullRequestThread; root: PullRequestComment; replies: PullRequestComment[] }) {
	const [expanded, setExpanded] = useState(!thread.resolved && !thread.dismissed);
	const [repliesOpen, setRepliesOpen] = useState(false);
	const id = useId();
	const repliesId = useId();
	const more = Math.max(0, thread.commentCount - 1 - replies.length);
	const replyCount = replies.length + more;
	return (
		<li className={ROW_CLASS}>
			<Marker author={root.author} muted={!expanded} top />
			<div className="flex min-w-0 flex-wrap items-center gap-2 px-2 py-2 text-2xs text-muted-foreground">
				<FileCode2 aria-hidden className="size-3 shrink-0" />
				<span className="min-w-0 flex-1 truncate"><ThreadPlace detail={detail} thread={thread} /></span>
				{thread.resolved && <span className="inline-flex shrink-0 items-center gap-1 font-medium text-success-foreground"><CircleCheck aria-hidden className="size-3" />Resolved</span>}
				{thread.dismissed && <span className="font-medium">Review dismissed</span>}
				{thread.outdated && <span className="font-medium">Outdated</span>}
				<button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} thread on ${thread.path}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)} className={cn("ml-auto flex min-h-6 items-center gap-1 hover:text-foreground", FOCUS_CLASS)}>
					{!expanded && <span className="text-3xs">· {root.author.login}{replyCount > 0 && ` · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}</span>}
					<ChevronDown aria-hidden className={cn("size-3.5 shrink-0", expanded && "rotate-180")} />
				</button>
			</div>
			<div id={id} hidden={!expanded}>
				{expanded && <>
					<ConversationCard comment={root} />
					{replies.length > 0 && <div className="ml-2 border-l border-border/60 pl-3">
						<button type="button" aria-expanded={repliesOpen} aria-controls={repliesId} onClick={() => setRepliesOpen(value => !value)} className={cn("flex min-h-6 items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground", FOCUS_CLASS)}>
							{repliesOpen ? "Hide replies" : `${replies.length} more ${replies.length === 1 ? "reply" : "replies"}`}
							<ChevronDown aria-hidden className={cn("size-3", repliesOpen && "rotate-180")} />
						</button>
						<div id={repliesId} hidden={!repliesOpen} className="space-y-1">
							{repliesOpen && replies.map((reply, index) => <ConversationCard key={reply.url ?? index} comment={reply} action="replied" />)}
						</div>
					</div>}
					{more > 0 && <div className="flex flex-wrap items-baseline gap-2 px-2 py-1 text-xs text-muted-foreground">
						<span>{more} more {more === 1 ? "reply" : "replies"}</span>
						{root.url && <a href={root.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">View on GitHub</a>}
					</div>}
				</>}
			</div>
		</li>
	);
}

function CommitRow({ detail, commit }: { detail: PullRequestDetail; commit: PullRequestCommit }) {
	return (
		<li className={ROW_CLASS}>
			<Marker author={commit.author}><GitCommitHorizontal aria-hidden className="size-3.5" /></Marker>
			<a href={`https://github.com/${detail.owner}/${detail.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer" aria-label={`View commit ${commit.sha}`} className={cn("group flex min-w-0 items-center gap-2.5 py-1.5", FOCUS_CLASS)}>
				<div className="min-w-0 flex-1">
					<div title={commit.headline} className="truncate text-xs font-semibold text-foreground group-hover:text-primary">{commit.headline || "Untitled commit"}</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-muted-foreground"><code>{commit.sha.slice(0, 7)}</code><RelativeTime at={commit.at} /></div>
				</div>
				<span className="ml-auto shrink-0 font-mono text-3xs"><span className="text-diff-addition-foreground">+{commit.additions}</span>{" "}<span className="text-diff-deletion">−{commit.deletions}</span></span>
			</a>
		</li>
	);
}

function ReviewVerdict({ event, verdict, stale }: { event: PullRequestEvent; verdict: Verdict; stale: boolean }) {
	const { label, tone } = REVIEW_STYLE[verdict];
	return (
		<li className={ROW_CLASS}>
			<Marker author={event.author} top />
			<div className="flex min-w-0 flex-wrap items-start gap-2 py-1.5">
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
						<span className="font-semibold text-foreground">{event.author.login}</span>
						<Tooltip content="Before the latest commits" disabled={!stale}><span className={cn("font-medium lowercase", stale ? "text-muted-foreground opacity-70" : tone)}>{label}{stale && <span className="sr-only">, before the latest commits</span>}</span></Tooltip>
					</p>
					<div className="mt-0.5 text-2xs text-muted-foreground"><RelativeTime at={event.at} /></div>
				</div>
				<Reactions comment={event} />
				<HostLink url={event.url} />
			</div>
			{event.body.trim() && <div className="mt-3"><Markdown text={event.body} /></div>}
		</li>
	);
}

function LifecycleRow({ state, author, at }: { state: "opened" | "merged" | "closed"; author: Person | null; at: number }) {
	const Icon = state === "opened" ? GitPullRequest : state === "merged" ? GitMerge : GitPullRequestClosed;
	return (
		<li className={ROW_CLASS}>
			<Marker><Icon aria-hidden className="size-3.5" /></Marker>
			<div className="py-1.5 text-xs">
				<p className="flex flex-wrap items-center gap-1.5">{author && <span className="font-semibold">{author.login}</span>}<span className="font-semibold">Pull request {state}</span></p>
				<div className="mt-0.5 text-2xs text-muted-foreground"><RelativeTime at={at} /></div>
			</div>
		</li>
	);
}

function EntryView({ detail, row }: { detail: PullRequestDetail; row: TimelineRow }) {
	switch (row.kind) {
		case "comments": return <ConversationGroup events={row.events} />;
		case "thread": return <Thread detail={detail} thread={row.thread} root={row.root} replies={row.replies} />;
		case "commit": return <CommitRow detail={detail} commit={row.commit} />;
		case "review": return <ReviewVerdict event={row.event} verdict={row.verdict} stale={row.stale} />;
		case "new": return <NewDivider />;
		case "lifecycle": return <LifecycleRow state={row.state} author={row.author} at={row.at} />;
	}
}

function NewDivider() {
	return (
		<li className="relative mb-5 flex items-center gap-2 pl-12 py-1" aria-label="New since your last visit">
			<span className="h-px flex-1 bg-red-500/70" />
			<span className="text-xs font-semibold text-red-600 dark:text-red-400">New</span>
		</li>
	);
}

const SEEN_KEY = "omp-agents.pr-seen";
/** A visit older than this no longer marks anything new worth a line, so it leaves the store. */
const SEEN_KEEP_MS = 30 * 86_400_000;

function readSeen(): Record<string, number> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
		return stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
	} catch {
		return {};
	}
}

/**
 * When the viewer last opened the pull request's timeline, read once as it opens and recorded as this visit at once, so
 * the New line holds while it stays open and a closed browser tab still counts as a visit. `useStoredState` would move
 * the line the moment the visit is recorded.
 */
function useLastSeen(key: string): number | null {
	const [seen] = useState(() => {
		const at = readSeen()[key];
		return typeof at === "number" ? at : null;
	});
	useEffect(() => {
		const now = Date.now();
		const kept = Object.entries(readSeen()).filter(([other, at]) => other !== key && typeof at === "number" && now - at < SEEN_KEEP_MS);
		localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries([...kept, [key, now]])));
	}, [key]);
	return seen;
}

export function Timeline({ detail, placement }: { detail: PullRequestDetail; placement: Placement }) {
	const [newestFirst, setNewestFirst] = useState(true);
	const seen = useLastSeen(prKey(detail));
	const rows = timelineRows(detail, newestFirst, seen);
	const comments = commentCount(detail);
	const approvals = approvalCount(detail);
	return (
		<div data-pr-timeline className={cn("py-1", placement === "page" && "-mx-2")}>
			<div className="mx-auto mb-5 flex max-w-3xl flex-wrap items-center justify-end gap-3 text-2xs text-muted-foreground">
				<span aria-label={`${comments} comments`} className="flex items-center gap-1"><MessageSquare aria-hidden className="size-3" />{comments}</span>
				<span aria-label={`${detail.commits.length} commits`} className="flex items-center gap-1"><GitCommitHorizontal aria-hidden className="size-3" />{detail.commits.length}</span>
				<span aria-label={`${approvals} approvals`} className="flex items-center gap-1"><ThumbsUp aria-hidden className="size-3" />{approvals}</span>
				<Button variant="ghost-muted" size="xs" leadingIcon={ArrowDownUp} onClick={() => setNewestFirst(value => !value)}>{newestFirst ? "Newest first" : "Oldest first"}</Button>
			</div>
			<ul className="relative mx-auto max-w-3xl">
				<li aria-hidden className="pointer-events-none absolute bottom-5 left-[15px] top-1 w-px bg-border/45" />
				{rows.map(row => <EntryView key={row.key} detail={detail} row={row} />)}
			</ul>
		</div>
	);
}
