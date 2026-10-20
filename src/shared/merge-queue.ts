/** Merges the server carries out once GitHub allows them: one pull request, or a stack bottom first. */
import { arrayOf, fields, type Guard, isNumber, isString, nullable, oneOf, tagged } from "../json";
import { type PullRequest, samePullRequest } from "./github";
import { MERGE_METHODS, type MergeMethod } from "./source-control";

/** A pull request a queued merge takes, pinned to the head commit it may merge. */
export interface QueuedPullRequest extends PullRequest {
	title: string;
	/** Its head branch. */
	branch: string;
	/** The head commit the merge may take; only the queue's own update of the branch moves it. */
	head: string;
}

/** Where a queued merge stands: waiting on GitHub, or stopped with the reason. */
export type QueuedMergeState = { kind: "waiting"; why: string } | { kind: "failed"; why: string };

/** The changes the queue asks GitHub for that a read can show only later. */
export const SETTLE_STEPS = ["retarget", "ready", "update", "arm"] as const;
export type SettleStep = (typeof SETTLE_STEPS)[number];

/** A change the queue asked GitHub for at `at`, in ms since the epoch, that no read has shown yet. */
export interface Settling {
	step: SettleStep;
	at: number;
}

export interface QueuedMerge {
	id: string;
	method: MergeMethod;
	/** The branch every pull request of it lands in: the bottom one's base when it was queued. */
	base: string;
	/** The pull requests still to merge, bottom first; the first is the one under way. */
	prs: QueuedPullRequest[];
	/** How many of its pull requests merged already. */
	merged: number;
	/** Whether the queue armed GitHub's auto-merge on the first. */
	auto: boolean;
	/** The last change the queue asked GitHub for on the first, until a read shows it; `null` when none is still to show. */
	settling: Settling | null;
	state: QueuedMergeState;
}

/** The body of `PUT /api/merge-queue`: queue a pull request, or a stack in any order, or cancel a queued merge. */
export type MergeQueueChange =
	| {
			op: "add";
			method: MergeMethod;
			/** `head` is the commit the confirmation showed, `null` for one the server pins as it queues it. */
			prs: (PullRequest & { head: string | null })[];
	  }
	| { op: "cancel"; id: string };

/** The answer to `PUT /api/merge-queue`: the queued merges after the change, and the pull requests it merged on the way, which leave the list. */
export interface MergeQueueAnswer {
	merges: QueuedMerge[];
	merged: QueuedPullRequest[];
}

const isQueuedPullRequest = fields<QueuedPullRequest>({ owner: isString, repo: isString, number: isNumber, title: isString, branch: isString, head: isString });

/** A queued merge as `merges.json` keeps it. */
export const isQueuedMerge: Guard<QueuedMerge> = fields<QueuedMerge>({
	id: isString,
	method: oneOf(MERGE_METHODS),
	base: isString,
	prs: arrayOf(isQueuedPullRequest),
	merged: isNumber,
	auto: (value): value is boolean => typeof value === "boolean",
	settling: nullable(fields<Settling>({ step: oneOf(SETTLE_STEPS), at: isNumber })),
	state: tagged<QueuedMergeState, "kind">("kind", { waiting: { why: isString }, failed: { why: isString } }),
});

/** The queued merge that takes `pr`, if any. */
export const queuedMergeOf = (merges: readonly QueuedMerge[], pr: PullRequest): QueuedMerge | undefined => merges.find(merge => merge.prs.some(queued => samePullRequest(queued, pr)));
