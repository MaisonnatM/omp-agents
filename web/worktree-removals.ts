/**
 * **Delete** and **Remove merged** on Settings › Worktrees: a queue the page keeps while you move around it, which
 * removes one worktree at a time under a toast that counts the run, as **Rebase behind** does for pull requests.
 */
import { useSyncExternalStore } from "react";
import { errorText } from "../src/json";
import { MAX_WORKTREE_BATCH, type WorktreeRemovalPlan, type WorktreeTarget } from "../src/worktrees-shared";
import { changeWorktrees } from "./api";
import { loadingToast, settleToast, type ToastText, toasts } from "./components/toaster";

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

export const removalKey = (target: WorktreeTarget): string => `${target.repository}\0${target.path}`;

const nameOf = (target: RemovalTarget): string => target.branch ?? target.path.slice(target.path.lastIndexOf("/") + 1);

const worktrees = (count: number): string => `${count} ${count === 1 ? "worktree" : "worktrees"}`;

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** The runs to do, in order; the one removing stays first until it ends. */
const runs: Run[] = [];
let states: ReadonlyMap<string, RemovalState> = new Map();
/** When each worktree removed since the page loaded went, by {@link removalKey}, so a list read before then can drop it. */
let removedAt: ReadonlyMap<string, number> = new Map();
const listeners = new Set<() => void>();

function setState(key: string, state: RemovalState | null): void {
	const next = new Map(states);
	if (state) next.set(key, state);
	else next.delete(key);
	states = next;
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** Where `target` stands in the queue; `null` while it is not in it. */
export function useRemovalState(target: WorktreeTarget): RemovalState | null {
	const key = removalKey(target);
	return useSyncExternalStore(subscribe, () => states.get(key) ?? null);
}

/** Where each queued or removing worktree stands, by {@link removalKey}. */
export const useRemovalStates = (): ReadonlyMap<string, RemovalState> => useSyncExternalStore(subscribe, () => states);

/** When each worktree removed since the page loaded went, in ms since the epoch. */
export const useRemovedAt = (): ReadonlyMap<string, number> => useSyncExternalStore(subscribe, () => removedAt);

/** How a worktree's removal ended, and the toast that says so. */
interface Ended {
	outcome: Outcome;
	text: ToastText;
}

const blockerText = (blockers: { message: string }[]): string => blockers.map(blocker => blocker.message).join(" ");

/** Removes one previewed worktree, unless its preview says something blocks it or its removal would lose a commit. */
async function removeOne(plan: WorktreeRemovalPlan, target: RemovalTarget): Promise<Ended> {
	const name = nameOf(target);
	if (plan.blockers.length > 0) return { outcome: "kept", text: { title: `Kept ${name}`, description: blockerText(plan.blockers) } };
	if (plan.kind === "unreadable") return { outcome: "failed", text: { title: `Could not remove ${name}`, description: "The server could not read this checkout." } };
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

async function preview(targets: RemovalTarget[], merged: boolean): Promise<WorktreeRemovalPlan[]> {
	const plans: WorktreeRemovalPlan[] = [];
	for (let start = 0; start < targets.length; start += MAX_WORKTREE_BATCH) {
		const batch = targets.slice(start, start + MAX_WORKTREE_BATCH).map(({ repository, path }) => ({ repository, path }));
		plans.push(...(await changeWorktrees({ action: "preview", targets: batch, merged })).plans);
	}
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
	return { title, description: `${others.length > 0 ? `${AND.format(others)}. ` : ""}Branches and session transcripts stay.` };
}

/**
 * Whether a run of several also toasts a worktree's own outcome: a failure always; a kept one only when picked by hand,
 * since **Remove merged** expects to keep the merged ones something blocks, while a hand-picked one was removable.
 */
const TOASTS_ALONE: Record<Outcome, (run: Run) => boolean> = { removed: () => false, kept: run => !run.merged, failed: () => true };

async function execute(run: Run): Promise<void> {
	const { targets } = run;
	const byKey = new Map(targets.map(target => [removalKey(target), target]));
	const outcomes: Record<Outcome, number> = { removed: 0, kept: 0, failed: 0 };
	toasts.update(run.toast, progress(run, "checking"));
	let plans: WorktreeRemovalPlan[];
	try {
		plans = await preview(targets, run.merged);
	} catch (error) {
		for (const key of byKey.keys()) setState(key, null);
		settleToast(run.toast, { title: `Could not check ${targets.length === 1 ? nameOf(targets[0]!) : worktrees(targets.length)}`, description: errorText(error) });
		return;
	}
	let last: Ended | null = null;
	for (const [index, plan] of plans.entries()) {
		const key = removalKey(plan);
		const target = byKey.get(key) ?? { ...plan, branch: plan.kind === "unreadable" ? null : plan.branch };
		setState(key, "removing");
		toasts.update(run.toast, progress(run, { index, target }));
		last = await removeOne(plan, target);
		outcomes[last.outcome] += 1;
		if (last.outcome === "removed") removedAt = new Map(removedAt).set(key, Date.now());
		setState(key, null);
		if (plans.length > 1 && TOASTS_ALONE[last.outcome](run)) toasts.add(last.text);
	}
	// A target the preview did not answer for stays out of the queue.
	for (const key of byKey.keys()) if (states.has(key)) setState(key, null);
	settleToast(run.toast, plans.length === 1 && last ? last.text : summary(targets.length, outcomes));
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
	const fresh = targets.filter(target => !states.has(removalKey(target)));
	if (fresh.length === 0) return Promise.resolve();
	const { promise, resolve } = Promise.withResolvers<void>();
	const run: Run = { targets: fresh, merged, toast: "", done: resolve };
	run.toast = loadingToast(progress(run, runs.length > 0 ? "waiting" : "checking"));
	for (const target of fresh) setState(removalKey(target), "queued");
	runs.push(run);
	void drain();
	return promise;
}
