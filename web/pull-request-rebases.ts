/**
 * **Rebase on** a pull request's base: a queue the page keeps while you move around it, which runs one rebase at a time.
 * The server rebases the branch, runs the repository's checks, and pushes it; a conflict hands it to **Resolve conflicts**.
 */
import { useSyncExternalStore } from "react";
import { type PullRequest, type PullRequestRebase, type PullRequestSummary, prKey, type RebasedPullRequest, repoKey } from "../src/shared/github";
import { errorText } from "../src/json";
import { putJson } from "./api";
import { toasts } from "./components/toaster";

/** A pull request to rebase, from `cwd`, the workspace a session on it starts in. */
export interface RebaseJob {
	pr: PullRequestSummary;
	cwd: string;
}

/** What a run calls back: those of the page that queued it, even once you have moved to another workspace. */
export interface RebaseHooks {
	/** Starts **Resolve conflicts** on a pull request whose rebase stopped at a conflict. */
	resolve: (job: RebaseJob) => void;
	/** Reads the pull request list again, once the run ends. */
	refresh: () => void;
}

/** Where a pull request stands in the queue. */
export type RebaseState = "queued" | "running";

/** How a rebase ended: as the server answered, failed, or skipped, since the queue skips the stack above one that stopped. */
type Outcome = RebasedPullRequest["kind"] | "failed" | "skipped";

/** Whether an outcome stops the queue from rebasing the pull requests stacked above it. */
const STOPS: Record<Outcome, boolean> = { rebased: false, current: false, conflict: true, failed: true, skipped: true };

interface Run {
	/** A bulk run counts the pull requests that already had their base into the toast at its end, instead of a toast each. */
	bulk: boolean;
	hooks: RebaseHooks;
	total: number;
	left: number;
	outcomes: Record<Outcome, number>;
}

const queue: { job: RebaseJob; run: Run }[] = [];
let states: ReadonlyMap<string, RebaseState> = new Map();
let draining = false;
/** A branch of the pull request's repository, as one key: the queue spans repositories, and a stack links its pull requests by branch within one. */
const branchKey = (pr: PullRequest, branch: string): string => `${repoKey(pr)}:${branch}`;
/** The head branches, by {@link branchKey}, of the pull requests that stopped since the queue was last empty, whatever run queued them. */
const stopped = new Set<string>();
const listeners = new Set<() => void>();

function setState(key: string, state: RebaseState | null): void {
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

/** Where `pr` stands in the queue; `null` while it is not in it. */
export function useRebaseState(pr: PullRequest): RebaseState | null {
	const key = prKey(pr);
	return useSyncExternalStore(subscribe, () => states.get(key) ?? null);
}

/** Whether a rebase is queued or running. */
export const useRebasing = (): boolean => useSyncExternalStore(subscribe, () => states.size > 0);

/** Rebases `job`, toasting what came of it, unless a pull request below it stopped earlier. */
async function rebaseOne({ pr, cwd }: RebaseJob, run: Run): Promise<Outcome> {
	if (pr.stackedOn !== null && stopped.has(branchKey(pr, pr.stackedOn))) return "skipped";
	try {
		const request: PullRequestRebase = { owner: pr.owner, repo: pr.repo, number: pr.number, cwd };
		const done = await putJson<RebasedPullRequest>("/api/pull-request/rebase", request);
		if (done.kind === "rebased") toasts.add({ title: `Rebased ${done.branch} on ${done.onto}` });
		else if (done.kind === "current") {
			if (!run.bulk) toasts.add({ title: `${done.branch} already has ${done.onto}` });
		} else {
			const count = done.files.length;
			toasts.add({ title: `${done.branch} conflicts with ${done.onto}`, description: `${count} ${count === 1 ? "file conflicts" : "files conflict"}. A Resolve conflicts session takes over.` });
			run.hooks.resolve({ pr, cwd });
		}
		return done.kind;
	} catch (error) {
		toasts.add({ title: `Could not rebase ${pr.head}`, description: errorText(error) });
		return "failed";
	}
}

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** The toast that ends a bulk run: how many it rebased, then what became of the others. */
function summary({ total, outcomes }: Run): { title: string; description?: string } {
	const title = `Rebased ${outcomes.rebased} of ${total} ${total === 1 ? "pull request" : "pull requests"}`;
	const others = [
		outcomes.current > 0 && `${outcomes.current} already had ${outcomes.current === 1 ? "its" : "their"} base`,
		outcomes.conflict > 0 && `${outcomes.conflict} stopped at a conflict`,
		outcomes.failed > 0 && `${outcomes.failed} failed`,
		outcomes.skipped > 0 && `${outcomes.skipped} skipped, stacked on one that stopped`,
	].filter(part => part !== false);
	return others.length > 0 ? { title, description: `${AND.format(others)}.` } : { title };
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	for (let next = queue.shift(); next; next = queue.shift()) {
		const { job, run } = next;
		const key = prKey(job.pr);
		setState(key, "running");
		const outcome = await rebaseOne(job, run);
		setState(key, null);
		run.outcomes[outcome] += 1;
		if (STOPS[outcome]) stopped.add(branchKey(job.pr, job.pr.head));
		run.left -= 1;
		if (run.left > 0) continue;
		run.hooks.refresh();
		if (run.bulk) toasts.add(summary(run));
	}
	stopped.clear();
	draining = false;
}

function enqueue(jobs: readonly RebaseJob[], hooks: RebaseHooks, bulk: boolean): void {
	const fresh = jobs.filter(({ pr }) => !states.has(prKey(pr)));
	if (fresh.length === 0) return;
	const run: Run = { bulk, hooks, total: fresh.length, left: fresh.length, outcomes: { rebased: 0, current: 0, conflict: 0, failed: 0, skipped: 0 } };
	for (const job of fresh) {
		queue.push({ job, run });
		setState(prKey(job.pr), "queued");
	}
	void drain();
}

/** Queues the rebase of `job`; once it ends, a toast says what came of it and the list is read again. */
export const rebasePullRequest = (job: RebaseJob, hooks: RebaseHooks): void => enqueue([job], hooks, false);

/**
 * Queues the rebase of each of `jobs` in order, bottom of a stack first, skipping those stacked on one that conflicted,
 * failed, or was skipped. Once the last ends, one toast sums them up and the list is read again. A pull request already
 * queued keeps its place.
 */
export const rebasePullRequests = (jobs: readonly RebaseJob[], hooks: RebaseHooks): void => enqueue(jobs, hooks, true);
