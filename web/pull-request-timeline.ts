import type { Person, PullRequestComment, PullRequestCommit, PullRequestDetail, PullRequestEvent, PullRequestThread } from "../src/shared/github";

/** A review's verdict, which takes a row of its own where a commented review joins the conversation. */
export type Verdict = Exclude<PullRequestEvent["review"], null | "commented">;

export type TimelineRow =
	| { kind: "comments"; key: string; at: number; events: [PullRequestEvent, ...PullRequestEvent[]] }
	| { kind: "commit"; key: string; at: number; commit: PullRequestCommit }
	| { kind: "review"; key: string; at: number; event: PullRequestEvent; verdict: Verdict; stale: boolean }
	| { kind: "thread"; key: string; at: number; thread: PullRequestThread; root: PullRequestComment; replies: PullRequestComment[] }
	| { kind: "lifecycle"; key: string; at: number; state: "opened" | "merged" | "closed"; author: Person | null }
	| { kind: "new"; key: string; at: number };

/** How many reviewers' latest verdict approves the newest commit, as T3 counts the `latestPullRequestReviewOutcomes` that approve and are not stale. */
export function approvalCount({ conversation, commits }: Pick<PullRequestDetail, "conversation" | "commits">): number {
	const latest = new Map<string, { verdict: Verdict; at: number }>();
	for (const { author, review, at } of conversation) {
		if (review === null || review === "commented") continue;
		const current = latest.get(author.login);
		if (!current || current.at <= at) latest.set(author.login, { verdict: review, at });
	}
	const newestCommit = Math.max(...commits.map(commit => commit.at));
	return [...latest.values()].filter(({ verdict, at }) => verdict === "approved" && at >= newestCommit).length;
}

export function timelineRows(detail: PullRequestDetail, newestFirst: boolean, seen: number | null): TimelineRow[] {
	const newestCommit = Math.max(...detail.commits.map(commit => commit.at));
	const activity: TimelineRow[] = [{ kind: "lifecycle", key: "opened", at: detail.createdAt, state: "opened", author: detail.author }];
	for (const commit of detail.commits) activity.push({ kind: "commit", key: `commit:${commit.sha}`, at: commit.at, commit });
	for (const [index, event] of detail.conversation.entries()) {
		const key = `${event.url ?? event.at}:${index}`;
		const { review } = event;
		if (review === null || review === "commented") activity.push({ kind: "comments", key: `comments:${key}`, at: event.at, events: [event] });
		else activity.push({ kind: "review", key: `review:${key}`, at: event.at, event, verdict: review, stale: review !== "dismissed" && event.at < newestCommit });
	}
	for (const thread of detail.threads) {
		const [root, ...replies] = thread.comments;
		if (root) activity.push({ kind: "thread", key: `thread:${thread.id}`, at: root.at, thread, root, replies });
	}
	if (detail.mergedAt !== null) activity.push({ kind: "lifecycle", key: "merged", at: detail.mergedAt, state: "merged", author: null });
	else if (detail.closedAt !== null) activity.push({ kind: "lifecycle", key: "closed", at: detail.closedAt, state: "closed", author: null });
	activity.sort((a, b) => a.at - b.at);
	if (seen !== null) {
		const unread = activity.findIndex(item => item.at > seen);
		if (unread !== -1) activity.splice(unread, 0, { kind: "new", key: `new:${seen}`, at: seen });
	}
	if (newestFirst) activity.reverse();

	const rows: TimelineRow[] = [];
	for (const item of activity) {
		const last = rows.at(-1);
		// The oldest comment names a group, so an open group stays open when the order flips.
		if (last?.kind === "comments" && item.kind === "comments") rows[rows.length - 1] = { ...last, key: newestFirst ? item.key : last.key, events: [...last.events, ...item.events] };
		else rows.push(item);
	}
	return rows;
}
