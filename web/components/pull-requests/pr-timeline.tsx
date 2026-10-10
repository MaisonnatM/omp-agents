import { ArrowDownUp, GitCommitHorizontal, MessageSquare } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { type Person, type PullRequestCommit, type PullRequestDetail, type PullRequestEvent, type PullRequestThread, prKey } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { age } from "../../labels";
import { hashForPullRequestFiles } from "../../routing";
import { Markdown } from "../sheet-details";
import { Avatar } from "./avatars";

type Entry =
	| { kind: "commits"; at: number; author: Person; commits: PullRequestCommit[] }
	| { kind: "event"; at: number; author: Person; event: PullRequestEvent }
	| { kind: "thread"; at: number; author: Person; thread: PullRequestThread };

/** A run of one author's commits within an hour reads as one message, as Slack groups a sender's messages. */
const COMMIT_RUN_MS = 60 * 60_000;

function entriesOf(detail: PullRequestDetail): Entry[] {
	const entries: Entry[] = [];
	for (const commit of detail.commits) {
		const last = entries.at(-1);
		if (last?.kind === "commits" && last.author.login === commit.author.login && commit.at - last.at < COMMIT_RUN_MS) {
			last.commits.push(commit);
			last.at = commit.at;
		} else entries.push({ kind: "commits", at: commit.at, author: commit.author, commits: [commit] });
	}
	for (const event of detail.conversation) entries.push({ kind: "event", at: event.at, author: event.author, event });
	for (const thread of detail.threads) {
		const first = thread.comments[0];
		if (first) entries.push({ kind: "thread", at: first.at, author: first.author, thread });
	}
	return entries.toSorted((a, b) => a.at - b.at);
}

const DAY = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

function dayLabel(at: number): string {
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	const day = new Date(at);
	day.setHours(0, 0, 0, 0);
	const days = Math.round((start.getTime() - day.getTime()) / 86_400_000);
	return days === 0 ? "Today" : days === 1 ? "Yesterday" : DAY.format(at);
}

const REVIEW_PILL: Record<NonNullable<PullRequestEvent["review"]>, [string, string]> = {
	approved: ["Approved", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"],
	"changes-requested": ["Requested changes", "bg-red-500/10 text-red-700 dark:text-red-400"],
	commented: ["Reviewed", "bg-muted text-muted-foreground"],
	dismissed: ["Review dismissed", "bg-muted text-muted-foreground"],
};

function Message({ author, at, children }: { author: Person; at: number; children: ReactNode }) {
	return (
		<li className="flex gap-3 px-2 py-2 hover:bg-muted/40">
			<Avatar person={author} label={author.login} className="size-9 rounded-md ring-0 [&_img]:rounded-md" />
			<div className="min-w-0 flex-1 space-y-1">
				<p className="flex items-baseline gap-2">
					<span className="text-sm font-semibold">{author.login}</span>
					<Tooltip content={new Date(at).toLocaleString()}>
						<span className="text-xs text-muted-foreground">{TIME.format(at)}</span>
					</Tooltip>
				</p>
				{children}
			</div>
		</li>
	);
}

function CommitLines({ commits }: { commits: PullRequestCommit[] }) {
	return (
		<ul className="space-y-0.5">
			{commits.map(commit => (
				<li key={commit.sha} className="flex min-w-0 items-center gap-2 text-sm">
					<GitCommitHorizontal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">{commit.headline}</span>
					<span className="shrink-0 font-mono text-xs text-muted-foreground">{commit.sha}</span>
					<span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
						<span className="text-emerald-600 dark:text-emerald-400">+{commit.additions}</span> <span className="text-red-600 dark:text-red-400">−{commit.deletions}</span>
					</span>
				</li>
			))}
		</ul>
	);
}

/** A review thread as a Slack thread: its first comment, then a bar with who replied, how many, and when; the replies unfold under it. */
function Thread({ detail, thread }: { detail: PullRequestDetail; thread: PullRequestThread }) {
	const [open, setOpen] = useState(false);
	const [first, ...replies] = thread.comments;
	const last = replies.at(-1);
	const people = [...new Map(replies.map(reply => [reply.author.login, reply.author])).values()];
	return (
		<>
			<p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">Unresolved</span>
				on
				<a href={hashForPullRequestFiles(detail, thread.path)} className="min-w-0 font-mono break-all hover:text-foreground hover:underline">
					{thread.path}
					{thread.line !== null && `:${thread.line}`}
				</a>
			</p>
			{first && <Markdown text={first.body} />}
			{replies.length > 0 && (
				<button
					type="button"
					onClick={() => setOpen(value => !value)}
					className="-ml-1 flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-xs hover:border-border hover:bg-background"
				>
					<span className="flex -space-x-1">
						{people.map(person => (
							<Avatar key={person.login} person={person} label={person.login} className="size-5 rounded-md [&_img]:rounded-md" />
						))}
					</span>
					<span className="font-semibold text-sky-700 dark:text-sky-400">{open ? "Hide replies" : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}</span>
					{last && <span className="text-muted-foreground">Last reply {age(last.at)} ago</span>}
				</button>
			)}
			{open && (
				<ul className="mt-1 space-y-1 border-l-2 border-border pl-3">
					{replies.map((reply, index) => (
						<Message key={index} author={reply.author} at={reply.at}>
							<Markdown text={reply.body} />
						</Message>
					))}
				</ul>
			)}
		</>
	);
}

function EntryView({ detail, entry }: { detail: PullRequestDetail; entry: Entry }) {
	switch (entry.kind) {
		case "commits":
			return (
				<Message author={entry.author} at={entry.at}>
					<p className="text-xs text-muted-foreground">
						pushed {entry.commits.length} {entry.commits.length === 1 ? "commit" : "commits"}
					</p>
					<CommitLines commits={entry.commits} />
				</Message>
			);
		case "event": {
			const { event } = entry;
			const pill = event.review && REVIEW_PILL[event.review];
			return (
				<Message author={entry.author} at={entry.at}>
					{pill && <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium", pill[1])}>{pill[0]}</span>}
					{event.body.trim() && <Markdown text={event.body} />}
				</Message>
			);
		}
		case "thread":
			return (
				<Message author={entry.author} at={entry.at}>
					<Thread detail={detail} thread={entry.thread} />
				</Message>
			);
	}
}

function DayDivider({ label }: { label: string }) {
	return (
		<li aria-hidden className="sticky top-0 z-10 flex items-center py-2">
			<span className="h-px flex-1 bg-border" />
			<span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-medium shadow-xs">{label}</span>
			<span className="h-px flex-1 bg-border" />
		</li>
	);
}

function NewDivider() {
	return (
		<li className="flex items-center gap-2 py-1" aria-label="New since your last visit">
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

/** Commits, comments, reviews, and review threads in one Slack-like list: grouped by day, with a line under what is new since the last visit. */
export function Timeline({ detail }: { detail: PullRequestDetail }) {
	const [newestFirst, setNewestFirst] = useState(true);
	const seen = useLastSeen(prKey(detail));
	const sorted = entriesOf(detail);
	const entries = newestFirst ? sorted.toReversed() : sorted;
	const comments = detail.conversation.length + detail.threads.reduce((sum, thread) => sum + thread.comments.length, 0);
	let day: string | null = null;
	let newShown = false;
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<MessageSquare aria-hidden className="size-3.5" />
					{comments}
				</span>
				<span className="flex items-center gap-1">
					<GitCommitHorizontal aria-hidden className="size-3.5" />
					{detail.commits.length}
				</span>
				<Button variant="ghost" size="compact" leadingIcon={ArrowDownUp} onClick={() => setNewestFirst(value => !value)}>
					{newestFirst ? "Newest first" : "Oldest first"}
				</Button>
			</div>
			{entries.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing happened on it yet.</p>
			) : (
				<ul>
					{entries.map((entry, index) => {
						const label = dayLabel(entry.at);
						const isNew = seen !== null && entry.at > seen;
						// Newest first: the line sits under the last new entry. Oldest first: above the first one.
						const lineBefore = !newShown && seen !== null && (newestFirst ? !isNew && index > 0 && entries[index - 1]!.at > seen : isNew);
						if (lineBefore) newShown = true;
						const divider = label !== day;
						day = label;
						return (
							<Fragment key={index}>
								{lineBefore && <NewDivider />}
								{divider && <DayDivider label={label} />}
								<EntryView detail={detail} entry={entry} />
							</Fragment>
						);
					})}
				</ul>
			)}
		</div>
	);
}
