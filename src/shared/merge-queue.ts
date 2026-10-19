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
	/** When the queue last updated the first one's branch, in ms since the epoch; `null` when it has not. */
	updatedAt: number | null;
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

const isQueuedPullRequest = fields<QueuedPullRequest>({ owner: isString, repo: isString, number: isNumber, title: isString, branch: isString, head: isString });

/** A queued merge as `merges.json` keeps it. */
export const isQueuedMerge: Guard<QueuedMerge> = fields<QueuedMerge>({
	id: isString,
	method: oneOf(MERGE_METHODS),
	base: isString,
	prs: arrayOf(isQueuedPullRequest),
	merged: isNumber,
	auto: (value): value is boolean => typeof value === "boolean",
	updatedAt: nullable(isNumber),
	state: tagged<QueuedMergeState, "kind">("kind", { waiting: { why: isString }, failed: { why: isString } }),
});

/** The queued merge that takes `pr`, if any. */
export const queuedMergeOf = (merges: readonly QueuedMerge[], pr: PullRequest): QueuedMerge | undefined => merges.find(merge => merge.prs.some(queued => samePullRequest(queued, pr)));
