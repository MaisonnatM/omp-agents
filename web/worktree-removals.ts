/**
 * **Delete** and **Remove merged** on Settings › Worktrees: a queue the page keeps while you move around it, which
 * removes one worktree at a time under a toast that counts the run, as **Rebase behind** does for pull requests.
 */
import { useSyncExternalStore } from "react";
import { errorText } from "../src/json";
import { MAX_WORKTREE_BATCH, type WorktreeRemovalPlan, type WorktreeTarget, worktreeKey } from "../src/worktrees-shared";
import { changeWorktrees } from "./api";
import { loadingToast, settleToast, type ToastText, toasts } from "./components/toaster";
import { queueStates } from "./queue-states";

/** A worktree to remove, with its branch to name it by. */
export interface RemovalTarget extends WorktreeTarget {
	branch: string | null;
}

/** Where a worktree stands in the queue. */
export type RemovalState = "queued" | "removing";

type Outcome = "removed" | "kept" | "failed";

interface Run {
	targets: RemovalTarget[];
	/** **Remove merged**: the server also keeps each target whose work it cannot show merged. */
	merged: boolean;
	/** The id of its loading toast, which tells where it stands, then what came of it. */
	toast: string;
	done: () => void;
}

/** What a removal keeps, as each button's tooltip and the last toast say. */
export const REMOVAL_KEEPS = "Branches and session transcripts stay.";

const nameOf = (target: RemovalTarget): string => target.branch ?? target.path.slice(target.path.lastIndexOf("/") + 1);

const worktrees = (count: number): string => `${count} ${count === 1 ? "worktree" : "worktrees"}`;

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** The runs to do, in order; the one removing stays first until it ends. */
const runs: Run[] = [];
const states = queueStates<RemovalState>();
/**
 * When each worktree removed since the page loaded went, by {@link worktreeKey}, so a list read before then can drop it.
 * It only grows, by one entry per removal, for the page's lifetime.
 */
let removedAt: ReadonlyMap<string, number> = new Map();

/** Where `target` stands in the queue; `null` while it is not in it. */
export const useRemovalState = (target: WorktreeTarget): RemovalState | null => states.useState(worktreeKey(target));

/** Where each queued or removing worktree stands, by {@link worktreeKey}. */
export const useRemovalStates = (): ReadonlyMap<string, RemovalState> => states.useStates();

/** Whether a removal is queued or running. */
export const useRemoving = (): boolean => states.useBusy();

/** When each worktree removed since the page loaded went, in ms since the epoch. */
export const useRemovedAt = (): ReadonlyMap<string, number> => useSyncExternalStore(states.subscribe, () => removedAt);

/** How a worktree's removal ended, and the toast that says so. */
interface Ended {
	outcome: Outcome;
	text: ToastText;
}

const blockerText = (blockers: { message: string }[]): string => blockers.map(blocker => blocker.message).join(" ");

/** Removes one previewed worktree, unless its preview says something blocks it or its removal would lose a commit. */
async function removeOne(plan: WorktreeRemovalPlan, target: RemovalTarget): Promise<Ended> {
	const name = nameOf(target);
	// An unreadable plan always carries the blocker that says why.
	if (plan.kind === "unreadable" || plan.blockers.length > 0) return { outcome: "kept", text: { title: `Kept ${name}`, description: blockerText(plan.blockers) } };
	if (plan.detachedCommitLoss) return { outcome: "kept", text: { title: `Kept ${name}`, description: "Its detached commit is on no branch, tag, or remote, so removing it could lose that commit. Put a branch on it or push it, then delete it again." } };
	try {
		const { results } = await changeWorktrees({ action: "remove", plans: [{ repository: plan.repository, path: plan.path, confirmation: plan.confirmation }] });
		const result = results[0];
		if (!result) return { outcome: "failed", text: { title: `Could not remove ${name}`, description: "The server did not answer for it." } };
		if (result.removed) return { outcome: "removed", text: { title: `Removed ${name}`, description: "Its branch and session transcripts stay." } };
		if (result.error !== null) return { outcome: "failed", text: { title: `Could not remove ${name}`, description: result.error } };
		return { outcome: "kept", text: { title: `Kept ${name}`, description: blockerText(result.blockers) } };
	} catch (error) {
		return { outcome: "failed", text: { title: `Could not remove ${name}`, description: errorText(error) } };
	}
}

/** The server's plan for each of `targets`, in the same order. */
async function preview(targets: RemovalTarget[], merged: boolean): Promise<WorktreeRemovalPlan[]> {
	const plans: WorktreeRemovalPlan[] = [];
	for (let start = 0; start < targets.length; start += MAX_WORKTREE_BATCH) {
		const batch = targets.slice(start, start + MAX_WORKTREE_BATCH).map(({ repository, path }) => ({ repository, path }));
		plans.push(...(await changeWorktrees({ action: "preview", targets: batch, merged })).plans);
	}
	if (plans.length !== targets.length) throw new Error(`The server answered for ${plans.length} of ${worktrees(targets.length)}.`);
	return plans;
}

/** What a run's loading toast says while it waits, checks its worktrees, or removes `target`, the `index`th. */
function progress({ targets }: Run, place: "waiting" | "checking" | { index: number; target: RemovalTarget }): ToastText {
	const only = targets.length === 1 ? targets[0] : undefined;
	const title = only ? `Removing ${nameOf(only)}` : `Removing ${worktrees(targets.length)}`;
	if (place === "waiting") return { title, description: "Waiting for another removal" };
	if (place === "checking") return { title, description: only ? "Checking whether it can be removed" : "Checking whether they can be removed" };
	if (only) return { title, description: undefined };
	return { title: `Removing ${place.index + 1} of ${worktrees(targets.length)}`, description: nameOf(place.target) };
}

/** How a run of several ends: how many it removed, then what became of the others. */
function summary(total: number, outcomes: Record<Outcome, number>): ToastText {
	const title = `Removed ${outcomes.removed} of ${worktrees(total)}`;
	const others = [outcomes.kept > 0 && `${outcomes.kept} kept`, outcomes.failed > 0 && `${outcomes.failed} failed`].filter(part => part !== false);
	return { title, description: `${others.length > 0 ? `${AND.format(others)}. ` : ""}${REMOVAL_KEEPS}` };
}

/**
 * Whether a run of several also toasts a worktree's own outcome: a failure always; a kept one only when picked by hand,
 * since **Remove merged** expects to keep the merged ones something blocks, while a hand-picked one was removable.
 */
const TOASTS_ALONE: Record<Outcome, (run: Run) => boolean> = { removed: () => false, kept: run => !run.merged, failed: () => true };

async function execute(run: Run): Promise<void> {
	const { targets } = run;
	const outcomes: Record<Outcome, number> = { removed: 0, kept: 0, failed: 0 };
	toasts.update(run.toast, progress(run, "checking"));
	let plans: WorktreeRemovalPlan[];
	try {
		plans = await preview(targets, run.merged);
	} catch (error) {
		states.set(targets.map(worktreeKey), null);
		settleToast(run.toast, { title: `Could not check ${targets.length === 1 ? nameOf(targets[0]!) : worktrees(targets.length)}`, description: errorText(error) });
		return;
	}
	let last: Ended | null = null;
	for (const [index, target] of targets.entries()) {
		const key = worktreeKey(target);
		states.set([key], "removing");
		toasts.update(run.toast, progress(run, { index, target }));
		last = await removeOne(plans[index]!, target);
		outcomes[last.outcome] += 1;
		if (last.outcome === "removed") removedAt = new Map(removedAt).set(key, Date.now());
		// Also tells `useRemovedAt` subscribers, so the row leaves the list as its state clears.
		states.set([key], null);
		if (targets.length > 1 && TOASTS_ALONE[last.outcome](run)) toasts.add(last.text);
	}
	settleToast(run.toast, targets.length === 1 && last ? last.text : summary(targets.length, outcomes));
}

let draining = false;

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	for (let run = runs[0]; run; run = runs[0]) {
		await execute(run);
		runs.shift();
		run.done();
	}
	draining = false;
}

/**
 * Queues the removal of each of `targets` that is not already queued, under one toast that tells where the run stands
 * until it says what came of it; resolves once the run ends. `merged`, for **Remove merged**, keeps each one whose work
 * the server cannot show merged. A worktree whose detached commit no branch holds is kept, not removed.
 */
export function removeWorktrees(targets: readonly RemovalTarget[], merged: boolean): Promise<void> {
	const fresh = targets.filter(target => !states.current().has(worktreeKey(target)));
	if (fresh.length === 0) return Promise.resolve();
	const { promise, resolve } = Promise.withResolvers<void>();
	const run: Run = { targets: fresh, merged, toast: "", done: resolve };
	run.toast = loadingToast(progress(run, runs.length > 0 ? "waiting" : "checking"));
	states.set(fresh.map(worktreeKey), "queued");
	runs.push(run);
	void drain();
	return promise;
}
