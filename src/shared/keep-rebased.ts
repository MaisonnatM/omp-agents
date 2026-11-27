/**
 * **Keep rebased**: the repositories whose pull requests the server rebases onto their base whenever they fall behind,
 * and each rebase of one that stopped, remembered by the commits it stopped on so it is not tried again until either
 * moves.
 */
import { isNumber, isObject, isString, oneOf } from "../json";
import { type PullRequest, type PullRequestList, type PullRequestSummary, prKey, repoKey } from "./github";
import { rebaseApplies, rebaseOrder } from "./rebase-order";

/** A rebase **Keep rebased** stopped: a `conflict`, or a `failed` fetch, push, or refusal, with git's or the refusal's `why`. */
export interface RebaseStop extends PullRequest {
	title: string;
	branch: string;
	onto: string;
	/** The pull request's head commit and its base branch's commit when it stopped. */
	head: string;
	base: string;
	outcome: "conflict" | "failed";
	/** The conflicting files, one per line, or why it failed. */
	why: string;
	at: number;
}

/** What `keep-rebased.json` holds: `repos`, each a `repoKey` with **Keep rebased** on, sorted, and the stops by `prKey`. */
export interface KeepRebasedState {
	repos: string[];
	stops: Record<string, RebaseStop>;
}

export const EMPTY_KEEP_REBASED: KeepRebasedState = { repos: [], stops: {} };

/** `PUT /api/keep-rebased`: turn **Keep rebased** on or off for the repository `repo`, a `repoKey`. */
export interface KeepRebasedChange {
	repo: string;
	on: boolean;
}

/** `GET` and `PUT /api/keep-rebased`: the repositories with **Keep rebased** on, by `repoKey`. */
export interface KeepRebasedAnswer {
	repos: string[];
}

/** A change to `keep-rebased.json`: the switch, a stop to remember, a pull request whose stop is over, or the stops a pull request read ends. */
export type KeepRebasedEdit = ({ op: "switch" } & KeepRebasedChange) | { op: "stop"; stop: RebaseStop } | { op: "forget"; key: string } | { op: "read"; list: PullRequestList };

const isStop = (value: unknown): value is RebaseStop =>
	isObject(value) &&
	[value.owner, value.repo, value.title, value.branch, value.onto, value.head, value.base, value.why].every(isString) &&
	isNumber(value.number) &&
	isNumber(value.at) &&
	oneOf(["conflict", "failed"] as const)(value.outcome);

export function parseKeepRebased(value: unknown): KeepRebasedState | null {
	if (!isObject(value) || !Array.isArray(value.repos) || !value.repos.every(isString) || !isObject(value.stops)) return null;
	return Object.values(value.stops).every(isStop) ? { repos: value.repos, stops: value.stops as Record<string, RebaseStop> } : null;
}

/** Whether `stop` still holds for `pr`: neither its head nor its base's commit moved since. */
const stillStopped = (stop: RebaseStop, pr: PullRequestSummary): boolean => stop.head === pr.headOid && stop.base === pr.baseOid;

/**
 * The stops `list` leaves: a repository GitHub answered for drops each stop whose pull request is no longer one a rebase
 * applies to or whose commits moved; one it did not answer for keeps them.
 */
function stopsAfterRead(stops: Record<string, RebaseStop>, list: PullRequestList): Record<string, RebaseStop> {
	const answered = new Set<string>();
	const listed = new Map<string, PullRequestSummary>();
	for (const repo of list.repos) {
		if (!("pullRequests" in repo)) continue;
		answered.add(repoKey(repo));
		for (const pr of repo.pullRequests) listed.set(prKey(pr), pr);
	}
	const kept = Object.entries(stops).filter(([key, stop]) => {
		if (!answered.has(repoKey(stop))) return true;
		const pr = listed.get(key);
		return pr !== undefined && rebaseApplies(pr) && stillStopped(stop, pr);
	});
	return kept.length === Object.keys(stops).length ? stops : Object.fromEntries(kept);
}

/** `state` after `edit`, or `state` itself when it changes nothing. Turning a repository off forgets its stops, so turning it on again tries them again. */
export function applyKeepRebased(state: KeepRebasedState, edit: KeepRebasedEdit): KeepRebasedState {
	switch (edit.op) {
		case "switch": {
			if (state.repos.includes(edit.repo) === edit.on) return state;
			if (edit.on) return { ...state, repos: [...state.repos, edit.repo].sort() };
			const stops = Object.fromEntries(Object.entries(state.stops).filter(([, stop]) => repoKey(stop) !== edit.repo));
			return { repos: state.repos.filter(repo => repo !== edit.repo), stops };
		}
		case "stop":
			return { ...state, stops: { ...state.stops, [prKey(edit.stop)]: edit.stop } };
		case "forget": {
			if (!(edit.key in state.stops)) return state;
			const { [edit.key]: _, ...stops } = state.stops;
			return { ...state, stops };
		}
		case "read": {
			const stops = stopsAfterRead(state.stops, edit.list);
			return stops === state.stops ? state : { ...state, stops };
		}
		default: {
			const unhandled: never = edit;
			return unhandled;
		}
	}
}

/** A rebase **Keep rebased** runs: the pull request, the workspace it runs in, and the commits the read gave, which a stop is remembered by. */
export interface KeepRebasedRun {
	pr: PullRequestSummary;
	cwd: string;
	head: string;
	base: string;
}

/**
 * What **Keep rebased** rebases after a read of `list`, in order: in each repository with it on and a workspace, every
 * pull request a rebase applies to, as **Rebase N behind** chooses them, bottom of each stack first. It leaves out one
 * whose last rebase stopped on the commits it has now, one whose commits the read did not give, and every one stacked
 * above a pull request it leaves out.
 */
export function keepRebasedRuns(list: PullRequestList, { repos, stops }: KeepRebasedState): KeepRebasedRun[] {
	const on = new Set(repos);
	return list.repos.flatMap(repo => {
		const cwd = repo.cwds[0];
		if (!("pullRequests" in repo) || cwd === undefined || !on.has(repoKey(repo))) return [];
		const held = new Set<string>();
		return rebaseOrder(repo.pullRequests)
			.filter(rebaseApplies)
			.flatMap(pr => {
				const { headOid: head, baseOid: base } = pr;
				const stop = stops[prKey(pr)];
				if ((pr.stackedOn !== null && held.has(pr.stackedOn)) || !head || !base || (stop && stillStopped(stop, pr))) {
					held.add(pr.head);
					return [];
				}
				return [{ pr, cwd, head, base }];
			});
	});
}
