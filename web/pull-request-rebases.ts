/**
 * **Rebase on** a pull request's base: a queue the page keeps while you move around it, which runs one rebase at a time.
 * The server rebases the branch, runs the repository's checks, and pushes it; a conflict hands it to **Resolve conflicts**.
 */
import { useSyncExternalStore } from "react";
import { type PullRequest, type PullRequestRebase, type PullRequestSummary, prKey, type RebasedPullRequest, repoKey } from "../src/shared/github";
import { errorText } from "../src/json";
import { putJson } from "./api";
import { loadingToast, settleToast, type ToastText, toasts } from "./components/toaster";

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

/** What a run's loading toast reads from it. */
interface RunFacts {
	/** A bulk run counts its pull requests in one toast that sums them up at its end, instead of a toast each. */
	bulk: boolean;
	/** The run's first job: a single run's only one. */
	first: RebaseJob;
	total: number;
	left: number;
}

interface Run extends RunFacts {
	hooks: RebaseHooks;
	outcomes: Record<Outcome, number>;
	/** The id of its loading toast, which tells where it stands, then what came of it. */
	toast: string;
}

interface Entry {
	job: RebaseJob;
	run: Run;
}

const queue: Entry[] = [];
/** The job rebasing now, off the queue. */
let running: Entry | null = null;
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

/** How a rebase ended, and the toast that says so. */
interface Ended {
	outcome: Outcome;
	text: ToastText;
}

/** Rebases `job`, unless a pull request below it stopped earlier, and hands a conflict to **Resolve conflicts**. */
async function rebaseOne({ pr, cwd }: RebaseJob, run: Run): Promise<Ended> {
	if (pr.stackedOn !== null && stopped.has(branchKey(pr, pr.stackedOn))) return { outcome: "skipped", text: { title: `Did not rebase ${pr.head}`, description: `It is stacked on ${pr.stackedOn}, whose rebase stopped.` } };
	try {
		const request: PullRequestRebase = { owner: pr.owner, repo: pr.repo, number: pr.number, cwd };
		const done = await putJson<RebasedPullRequest>("/api/pull-request/rebase", request);
		if (done.kind === "rebased") return { outcome: done.kind, text: { title: `Rebased ${done.branch} on ${done.onto}` } };
		if (done.kind === "current") return { outcome: done.kind, text: { title: `${done.branch} already has ${done.onto}` } };
		run.hooks.resolve({ pr, cwd });
		const count = done.files.length;
		return { outcome: done.kind, text: { title: `${done.branch} conflicts with ${done.onto}`, description: `${count} ${count === 1 ? "file conflicts" : "files conflict"}. A Resolve conflicts session takes over.` } };
	} catch (error) {
		return { outcome: "failed", text: { title: `Could not rebase ${pr.head}`, description: errorText(error) } };
	}
}

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** `1 of 1 pull request`, `2 of 5 pull requests`. */
const ofTotal = (count: number, total: number): string => `${count} of ${total} ${total === 1 ? "pull request" : "pull requests"}`;

/** How a bulk run ends: how many it rebased, then what became of the others. */
function summary({ total, outcomes }: Run): ToastText {
	const title = `Rebased ${ofTotal(outcomes.rebased, total)}`;
	const others = [
		outcomes.current > 0 && `${outcomes.current} already had ${outcomes.current === 1 ? "its" : "their"} base`,
		outcomes.conflict > 0 && `${outcomes.conflict} stopped at a conflict`,
		outcomes.failed > 0 && `${outcomes.failed} failed`,
		outcomes.skipped > 0 && `${outcomes.skipped} skipped, stacked on one that stopped`,
	].filter(part => part !== false);
	return others.length > 0 ? { title, description: `${AND.format(others)}.` } : { title };
}

/** What a run's loading toast says while its next pull request waits behind `ahead` rebases, or while `job` runs. */
function progress(run: RunFacts, place: { job: RebaseJob } | { ahead: number }): ToastText {
	const { pr } = run.first;
	const title = run.bulk ? `Rebasing ${ofTotal(run.total - run.left + 1, run.total)}` : `Rebasing ${pr.head} on ${pr.base}`;
	if ("ahead" in place) return { title, description: `Queued behind ${place.ahead} ${place.ahead === 1 ? "rebase" : "rebases"}` };
	return { title, description: run.bulk ? `${place.job.pr.head} on ${place.job.pr.base}` : "Fetching, rebasing, and pushing through the pre-push checks" };
}

/** Brings each run's loading toast up to where the queue stands: the running job's, then each waiting run's place in line. */
function showProgress(): void {
	const lined = running ? [running, ...queue] : queue;
	const shown = new Set<Run>();
	lined.forEach(({ job, run }, at) => {
		if (shown.has(run)) return;
		shown.add(run);
		toasts.update(run.toast, progress(run, running && at === 0 ? { job } : { ahead: at }));
	});
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	for (let next = queue.shift(); next; next = queue.shift()) {
		running = next;
		const { job, run } = next;
		const key = prKey(job.pr);
		setState(key, "running");
		showProgress();
		const { outcome, text } = await rebaseOne(job, run);
		running = null;
		setState(key, null);
		run.outcomes[outcome] += 1;
		if (STOPS[outcome]) stopped.add(branchKey(job.pr, job.pr.head));
		run.left -= 1;
		if (!run.bulk) settleToast(run.toast, text);
		// A bulk run's toast counts the rebased ones and those that had their base; what stopped one gets a toast of its own.
		else if (outcome === "conflict" || outcome === "failed") toasts.add(text);
		if (run.left > 0) continue;
		run.hooks.refresh();
		if (run.bulk) settleToast(run.toast, summary(run));
	}
	stopped.clear();
	draining = false;
}

function enqueue(jobs: readonly RebaseJob[], hooks: RebaseHooks, bulk: boolean): void {
	const fresh = jobs.filter(({ pr }) => !states.has(prKey(pr)));
	const first = fresh[0];
	if (!first) return;
	const ahead = queue.length + (running ? 1 : 0);
	const facts: RunFacts = { bulk, first, total: fresh.length, left: fresh.length };
	// With nothing ahead, `drain` starts it at once.
	const toast = loadingToast(progress(facts, ahead > 0 ? { ahead } : { job: first }));
	const run: Run = { ...facts, hooks, outcomes: { rebased: 0, current: 0, conflict: 0, failed: 0, skipped: 0 }, toast };
	for (const job of fresh) {
		queue.push({ job, run });
		setState(prKey(job.pr), "queued");
	}
	void drain();
}

/** Queues the rebase of `job`, under a toast that tells where it stands until it says what came of it; the list is then read again. */
export const rebasePullRequest = (job: RebaseJob, hooks: RebaseHooks): void => enqueue([job], hooks, false);

/**
 * Queues the rebase of each of `jobs` in order, bottom of a stack first, skipping those stacked on one that conflicted,
 * failed, or was skipped. One toast counts them as they run and sums them up once the last ends, and the list is read
 * again; a conflict or a failure also toasts on its own. A pull request already queued keeps its place.
 */
export const rebasePullRequests = (jobs: readonly RebaseJob[], hooks: RebaseHooks): void => enqueue(jobs, hooks, true);
