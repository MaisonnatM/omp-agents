/**
 * **Rebase on** a pull request's base: a queue the page keeps while you move around it, which runs one rebase at a time.
 * The server rebases the branch, runs the repository's checks, and pushes it; a conflict hands it to **Resolve conflicts**.
 */
import { type PullRequest, type PullRequestRebase, type PullRequestSummary, prKey, type RebasedPullRequest, type RebaseStep, repoKey } from "../src/shared/github";
import { errorText } from "../src/json";
import { queueStates } from "./queue-states";
import { putSteps } from "./api";
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

interface Run {
	/** A bulk run counts its pull requests in one toast that sums them up at its end, instead of a toast each. */
	bulk: boolean;
	hooks: RebaseHooks;
	total: number;
	left: number;
	outcomes: Record<Outcome, number>;
	/** The id of its loading toast, which tells where it stands, then what came of it. */
	toast: string;
}

interface Entry {
	job: RebaseJob;
	run: Run;
}

/** The jobs to rebase, in order; the one rebasing stays first until it ends. */
const queue: Entry[] = [];
const states = queueStates<RebaseState>();
let draining = false;
/** A branch of the pull request's repository, as one key: the queue spans repositories, and a stack links its pull requests by branch within one. */
const branchKey = (pr: PullRequest, branch: string): string => `${repoKey(pr)}:${branch}`;
/**
 * The head branches, by {@link branchKey}, whose latest rebase since the queue was last empty stopped, whatever run
 * queued it; one that rebases again later leaves.
 */
const stopped = new Set<string>();

/** Where `pr` stands in the queue; `null` while it is not in it. */
export function useRebaseState(pr: PullRequest): RebaseState | null {
	const key = prKey(pr);
	return states.useState(key);
}

/** Whether a rebase is queued or running. */
export const useRebasing = (): boolean => states.useBusy();

/** How a rebase ended, and the toast that says so. */
interface Ended {
	outcome: Outcome;
	text: ToastText;
}

/** Rebases the running job, at `queue[0]`, unless a pull request below it stopped earlier, and hands a conflict to **Resolve conflicts**. */
async function rebaseOne({ job, run }: Entry): Promise<Ended> {
	const { pr, cwd } = job;
	if (pr.stackedOn !== null && stopped.has(branchKey(pr, pr.stackedOn))) return { outcome: "skipped", text: { title: `Did not rebase ${pr.head}`, description: `It is stacked on ${pr.stackedOn}, whose rebase stopped.` } };
	try {
		toasts.update(run.toast, progress(run, job, { step: null }));
		showQueue();
		const request: PullRequestRebase = { owner: pr.owner, repo: pr.repo, number: pr.number, cwd };
		const done = await putSteps<RebaseStep, RebasedPullRequest>("/api/pull-request/rebase", request, step => toasts.update(run.toast, progress(run, job, { step })));
		if (done.kind === "rebased") return { outcome: done.kind, text: { title: `Rebased ${done.branch} on ${done.onto}` } };
		if (done.kind === "current") return { outcome: done.kind, text: { title: `${done.branch} already has ${done.onto}` } };
		run.hooks.resolve({ pr, cwd });
		return { outcome: done.kind, text: { title: `${done.branch} conflicts with ${done.onto}`, description: `${conflictingFiles(done.files)}. A Resolve conflicts session takes over.` } };
	} catch (error) {
		return { outcome: "failed", text: { title: `Could not rebase ${pr.head}`, description: errorText(error) } };
	}
}

/** How many files listed in a toast before the rest become a count. */
const NAMED_FILES = 3;

/** `2 files conflict: a.ts and b.ts`, naming the first few and counting the rest. */
function conflictingFiles(files: readonly string[]): string {
	const named = files.slice(0, NAMED_FILES);
	const rest = files.length - named.length;
	const names = AND.format(rest > 0 ? [...named, `${rest} more`] : named);
	return `${files.length} ${files.length === 1 ? "file conflicts" : "files conflict"}: ${names}`;
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

/** What the running rebase is doing, by the step the server last said it started. */
const STEP_WORDS: Record<RebaseStep, (pr: PullRequestSummary) => string> = {
	waiting: () => "Waiting for another rebase in this repository",
	fetching: pr => `Fetching ${pr.base} and ${pr.head}`,
	rebasing: pr => `Rebasing onto ${pr.base}`,
	pushing: () => "Pushing through the pre-push checks",
};

/** What a run's loading toast says while `job` waits behind `ahead` rebases, or runs at `step`. */
function progress(run: Pick<Run, "bulk" | "total" | "left">, { pr }: RebaseJob, place: { ahead: number } | { step: RebaseStep | null }): ToastText {
	const title = run.bulk ? `Rebasing ${ofTotal(run.total - run.left + 1, run.total)}` : `Rebasing ${pr.head} on ${pr.base}`;
	if ("ahead" in place) return { title, description: `Queued behind ${place.ahead} ${place.ahead === 1 ? "rebase" : "rebases"}` };
	// Before its first step, the server reads the pull request's branches from GitHub.
	const words = place.step === null ? "Reading the pull request" : STEP_WORDS[place.step](pr);
	return { title, description: run.bulk ? `${pr.head}: ${words}` : words };
}

/** Tells each run waiting behind the running job, at `queue[0]`, how many rebases are ahead of its next one. */
function showQueue(): void {
	const seen = new Set<Run>();
	queue.forEach(({ job, run }, ahead) => {
		if (seen.has(run)) return;
		seen.add(run);
		if (ahead > 0) toasts.update(run.toast, progress(run, job, { ahead }));
	});
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		for (let next = queue[0]; next; next = queue[0]) {
			const { job, run } = next;
			const key = prKey(job.pr);
			states.set([key], "running");
			const { outcome, text } = await rebaseOne(next);
			queue.shift();
			states.set([key], null);
			run.outcomes[outcome] += 1;
			const branch = branchKey(job.pr, job.pr.head);
			if (STOPS[outcome]) stopped.add(branch);
			else stopped.delete(branch);
			run.left -= 1;
			if (!run.bulk) settleToast(run.toast, text);
			// A bulk run's toast counts the rebased ones and those that had their base; what stopped one gets a toast of its own.
			else if (outcome === "conflict" || outcome === "failed") toasts.add(text);
			if (run.left > 0) continue;
			if (run.bulk) settleToast(run.toast, summary(run));
			run.hooks.refresh();
		}
	} catch (error) {
		// A page callback that threw, such as `refresh`, ends this pass; the jobs behind it still run.
		console.error("The rebase queue hit an error:", error);
	} finally {
		draining = false;
		if (queue.length > 0) void drain();
		else stopped.clear();
	}
}

function enqueue(jobs: readonly RebaseJob[], hooks: RebaseHooks, bulk: boolean): void {
	const fresh = jobs.filter(({ pr }) => !states.current().has(prKey(pr)));
	const first = fresh[0];
	if (!first) return;
	const ahead = queue.length;
	const counts = { bulk, total: fresh.length, left: fresh.length };
	// With nothing ahead, `drain` starts it at once.
	const toast = loadingToast(progress(counts, first, ahead > 0 ? { ahead } : { step: null }));
	const run: Run = { ...counts, hooks, outcomes: { rebased: 0, current: 0, conflict: 0, failed: 0, skipped: 0 }, toast };
	for (const job of fresh) {
		queue.push({ job, run });
		states.set([prKey(job.pr)], "queued");
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
