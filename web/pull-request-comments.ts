/** Summary's conversations as data: threads and top-level comments in one list, the stored filter, and the paging. */
import type { PullRequestComment, PullRequestDetail, PullRequestEvent, PullRequestThread } from "../src/shared/github";

interface CommentFilter {
	bots: boolean;
	resolved: boolean;
}

type ConversationItem =
	| { kind: "thread"; id: string; at: number; thread: PullRequestThread; comments: PullRequestComment[] }
	| { kind: "event"; id: string; at: number; event: PullRequestEvent; comments: PullRequestComment[] };

export function decodeCommentFilter(raw: string | null): CommentFilter {
	try {
		const value = JSON.parse(raw ?? "null");
		if (typeof value?.bots === "boolean" && typeof value?.resolved === "boolean") return { bots: value.bots, resolved: value.resolved };
	} catch {}
	return { bots: false, resolved: false };
}

export function conversationItems(detail: Pick<PullRequestDetail, "threads" | "conversation">): ConversationItem[] {
	return [
		...detail.threads.flatMap((thread): ConversationItem[] => thread.comments.length ? [{ kind: "thread", id: thread.id, at: thread.comments[0]!.at, thread, comments: thread.comments }] : []),
		...detail.conversation.filter(event => event.body.trim() || event.review).map((event, index): ConversationItem => ({ kind: "event", id: event.url ?? `event:${index}`, at: event.at, event, comments: [event] })),
	].toSorted((a, b) => b.at - a.at);
}

export function filterConversations(items: ConversationItem[], filter: CommentFilter): ConversationItem[] {
	return items.filter(item => {
		const finished = item.kind === "thread" ? item.thread.resolved || item.thread.dismissed : item.event.review === "dismissed";
		if (!filter.resolved && finished) return false;
		return filter.bots || item.comments.some(comment => !comment.author.isBot && !/\[bot\]$/i.test(comment.author.login));
	});
}

export function pageConversations(items: ConversationItem[], count: number, order: "newest" | "oldest"): { visible: ConversationItem[]; hidden: number } {
	const recent = items.slice(0, count);
	return { visible: order === "oldest" ? recent.toReversed() : recent, hidden: Math.max(0, items.length - recent.length) };
}
