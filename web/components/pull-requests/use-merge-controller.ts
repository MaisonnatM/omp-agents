/** `useMergeController`: one merge's method, queue lookup, submission, and cancellation. */
import { useState } from "react";
import type { PullRequest, PullRequestDetail, StackedPullRequest } from "../../../src/shared/github";
import { type MergeQueueChange, type QueuedMerge, queuedMergeOf } from "../../../src/shared/merge-queue";
import { type MergeMethod, startingMethod } from "../../../src/shared/source-control";
import { useLastMergeMethod, useMergeMethodChoice } from "../../merge-method";
import { writeMergeQueue } from "../../reads";
import { type Action, useAction } from "../../use-action";
import { useDashboardStatus } from "../dashboard-context";

/** The queue's request to merge `pr`, or `stack` bottom first, pinning only the bottom one to `head`, the head its confirmation showed. */
export function mergeRequest(pr: PullRequest, stack: readonly StackedPullRequest[] | undefined, method: MergeMethod, head: string): MergeQueueChange {
	const bottomFirst = stack ? stack.toReversed() : [pr];
	return { op: "add", method, prs: bottomFirst.map(({ owner, repo, number }, index) => ({ owner, repo, number, head: index === 0 ? head : null })) };
}

/** Cancels `merge`, or dismisses it once it stopped. */
export function useCancelMerge(merge: QueuedMerge | undefined, onCancelled?: () => void): Action<[]> {
	const { pullRequestsScope } = useDashboardStatus();
	return useAction(async () => {
		if (!merge) return;
		await writeMergeQueue(pullRequestsScope, { op: "cancel", id: merge.id });
		onCancelled?.();
	}, "Could not cancel the merge");
}

export interface MergeControllerOptions {
	/** The pull request to merge: the bottom one of `stack`, when it merges a stack. */
	pr: PullRequest;
	/** The stack to merge, top first as its rail lists it; absent to merge `pr` alone. */
	stack?: StackedPullRequest[];
	/** The methods GitHub allows and the head the merge is pinned to; `null` while they are read. */
	target: Pick<PullRequestDetail, "mergeMethods" | "headOid"> | null;
	/** The server took the merge, whether it merged at once or waits. */
	onQueued?: () => void;
	/** The server dropped the queued merge. */
	onCancelled?: () => void;
}

export interface MergeController {
	allowed: MergeMethod[];
	/** The method a confirmed merge uses; `null` when GitHub allows none. */
	method: MergeMethod | null;
	/** Switches the method for this merge alone; only a confirmed merge remembers it as the last one. */
	pick: (method: MergeMethod) => void;
	/** The queued merge that takes `pr` or a pull request of `stack`. */
	queued: QueuedMerge | undefined;
	/** The server is taking the merge. */
	merging: boolean;
	/** The server is taking the merge or its cancellation. */
	pending: boolean;
	/** Queues the merge with `method`, pinned to the target's head, and remembers the method as the last one. */
	merge: () => void;
	/** Cancels or dismisses `queued`. */
	cancel: Action<[]>;
}

export function useMergeController({ pr, stack, target, onQueued, onCancelled }: MergeControllerOptions): MergeController {
	const { merges, pullRequestsScope } = useDashboardStatus();
	const [choice] = useMergeMethodChoice();
	const [last, setLast] = useLastMergeMethod();
	const [picked, pick] = useState<MergeMethod | null>(null);
	const allowed = target?.mergeMethods ?? [];
	const method = picked && allowed.includes(picked) ? picked : startingMethod(choice, last, allowed);
	const queued = queuedMergeOf(merges, pr) ?? stack?.map(stacked => queuedMergeOf(merges, stacked)).find(Boolean);
	const queue = useAction(async (method: MergeMethod, head: string) => {
		await writeMergeQueue(pullRequestsScope, mergeRequest(pr, stack, method, head));
		onQueued?.();
	}, "Could not merge");
	const cancel = useCancelMerge(queued, onCancelled);
	const merge = (): void => {
		if (!target || !method) return;
		setLast(method);
		queue.run(method, target.headOid);
	};
	return { allowed, method, pick, queued, merging: queue.pending, pending: queue.pending || cancel.pending, merge, cancel };
}
