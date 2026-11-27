/** Which replies of each Board thread you have read in this browser, how many others are unread, as Slack's thread pill counts them, and what waits on you in each Workspace. */
import { useSyncExternalStore } from "react";
import type { RosterHost } from "../../../src/shared/sessions";
import type { BoardAuthor, BoardReply, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";
import { needsYou } from "../../attention";
import { workspaceCwd } from "../../sessions";

/** How many replies of each Board task's thread you have seen, by task id. */
export type Seen = Readonly<Record<string, number>>;

export const said = (task: BoardTask): Extract<BoardReply, { by: BoardAuthor }>[] => task.replies.filter((entry): entry is Extract<BoardReply, { by: BoardAuthor }> => "by" in entry);

const SEEN_KEY = "omp-agents.board-thread-seen";
const seenListeners = new Set<() => void>();
let seen: Seen = {};
try {
	seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Seen;
} catch {}

export function markSeen(id: number, count: number) {
	if (seen[id] === count) return;
	seen = { ...seen, [id]: count };
	localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
	for (const listener of seenListeners) listener();
}

export const useSeen = (): Seen =>
	useSyncExternalStore(
		listener => {
			seenListeners.add(listener);
			return () => seenListeners.delete(listener);
		},
		() => seen,
	);

/** Replies past the ones seen that someone else wrote: the unread count. The line a session leaves with a quiet done, having found nothing to report, counts for nothing. */
export const unreadOf = (task: BoardTask, seenCount: number | undefined): number => {
	const quiet = new Set(
		task.replies.filter((entry, index) => {
			const before = task.replies[index - 1];
			return "by" in entry && before !== undefined && "note" in before && before.note.kind === "done" && before.note.quiet === true;
		}),
	);
	return said(task).slice(seenCount ?? 0).filter(reply => reply.by.kind !== "user" && !quiet.has(reply)).length;
};

/** Of the Board tasks `ids`, in screen order, those in `unread` before the first and after the last of `visible`: the unread threads out of view above and below, each list nearest first. Before anything shows, none. */
export function unreadOutOfView(ids: readonly number[], unread: ReadonlySet<number>, visible: ReadonlySet<number>): { above: number[]; below: number[] } {
	const first = ids.findIndex(id => visible.has(id));
	if (first === -1) return { above: [], below: [] };
	const last = ids.findLastIndex(id => visible.has(id));
	return { above: ids.slice(0, first).filter(id => unread.has(id)).reverse(), below: ids.slice(last + 1).filter(id => unread.has(id)) };
}

/**
 * What waits on you in Workspace `workspace`, or in every Workspace for `null`: its live sessions among `hosts` that need you,
 * plus its Board threads with unread replies. The Board sidebar's Workspace count, the roster's workspace count while the Board is off, and the Dock badge all read it.
 */
export function waitingIn(board: BoardState | null, seen: Seen, hosts: readonly RosterHost[], workspace: string | null): number {
	const inIt = (cwd: string) => workspace === null || cwd === workspace;
	const sessions = hosts.filter(host => inIt(workspaceCwd(host)) && needsYou(host)).length;
	const threads = (board?.tasks ?? []).filter(task => inIt(task.workspace) && unreadOf(task, seen[task.id]) > 0).length;
	return sessions + threads;
}
