/**
 * The `watch_pull_request` tool a dashboard session gets, and the watches it saves in `pull-request-watches.json`: each
 * pull request list the activity check reads, the one the Pull requests page and the bell share, wakes a watching
 * session with one follow-up when its pull request's checks finish, its review decision or unresolved thread count
 * changes, or it merges or closes, so an agent that waits on a pull request ends its turn instead of polling.
 */
import { ReducerFile } from "../fs";
import { arrayOf, errorText, fields, isNumber, isObject, isString, nullable, oneOf } from "../json";
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import {
	type CheckState,
	prKey,
	type PullRequest,
	type PullRequestList,
	type PullRequestSummary,
	pullRequestName,
	pullRequestOfUrl,
	pullRequestUrl,
	type ReviewDecision,
	repoKey,
	samePullRequest,
} from "../shared/github";
import type { RosterHost, StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const WATCH_PULL_REQUEST_TOOL = "watch_pull_request";

/** How long a watch waits for its pull request to show in the list, whose search lags a new pull request, before it ends. */
export const UNLISTED_GRACE_MS = 10 * 60_000;

/** What a watch compares between two lists. */
export interface WatchedState {
	state: PullRequestSummary["state"];
	checks: CheckState;
	review: ReviewDecision;
	unresolved: number;
}

/** Session `sessionId`'s watch on `pr`, saved at `since`; `seen` is its state in the last list that held it, `null` before one did. */
export interface PullRequestWatch {
	sessionId: string;
	pr: PullRequest;
	since: number;
	seen: WatchedState | null;
}

export type WatchChange = { op: "watch"; watch: PullRequestWatch } | { op: "unwatch"; sessionId: string; pr: PullRequest };

const isWatch = fields<PullRequestWatch>({
	sessionId: isString,
	pr: fields<PullRequest>({ owner: isString, repo: isString, number: isNumber }),
	since: isNumber,
	seen: nullable(
		fields<WatchedState>({
			state: oneOf(["open", "draft", "merged"]),
			checks: oneOf(["passing", "failing", "pending", "none"]),
			review: oneOf(["approved", "changes-requested", "review-required", "none"]),
			unresolved: isNumber,
		}),
	),
});

const isOf = (watch: PullRequestWatch, sessionId: string, pr: PullRequest): boolean => watch.sessionId === sessionId && samePullRequest(watch.pr, pr);

/** `watches` after `change`: a session watches a pull request once, a new watch replacing its old one. */
export function applyWatch(watches: PullRequestWatch[], change: WatchChange): PullRequestWatch[] {
	if (change.op === "watch") return [...watches.filter(watch => !isOf(watch, change.watch.sessionId, change.watch.pr)), change.watch];
	const kept = watches.filter(watch => !isOf(watch, change.sessionId, change.pr));
	return kept.length === watches.length ? watches : kept;
}

export class PullRequestWatchesFile extends ReducerFile<PullRequestWatch[], [WatchChange]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) && arrayOf(isWatch)(value.watches) ? value.watches : null),
			toJson: watches => ({ watches }),
			holds: "a list of pull request watches",
			empty: [],
			reduce: applyWatch,
			shared: true,
		});
	}
}

export const watchedStateOf = (pr: PullRequestSummary): WatchedState => ({ state: pr.state, checks: pr.checks, review: pr.review, unresolved: pr.unresolved.count });

const describe = (pr: PullRequest): string => `${pullRequestName(pr)} (${pullRequestUrl(pr)})`;
const words = (value: string): string => value.replaceAll("-", " ");

/** What a watch does with one list that answered for its repository: the state it keeps, the message it wakes its session with, and whether it ends. */
export interface WatchStep {
	seen: WatchedState | null;
	wake: string | null;
	ends: boolean;
}

/**
 * The step of `watch` for a list whose answer for its repository holds `found`, or lacks its pull request. Checks that
 * start running again after a push wake nothing, so a push wakes the session once its checks finish; a draft flag
 * changing wakes nothing either.
 */
export function watchStep(watch: PullRequestWatch, found: PullRequestSummary | undefined, now: number): WatchStep {
	const name = describe(watch.pr);
	if (!found) {
		if (watch.seen)
			return {
				seen: watch.seen,
				ends: true,
				wake: `Pull request ${name} left the dashboard's pull request list, most likely closed without merging, so the dashboard stopped watching it. Check its state with gh before acting on it.`,
			};
		if (now - watch.since < UNLISTED_GRACE_MS) return { seen: null, wake: null, ends: false };
		return {
			seen: null,
			ends: true,
			wake: `The dashboard never saw pull request ${name} in its pull request list, which holds only your open pull requests and those asking for your review in a workspace's repository, so it stopped watching it. Check on it yourself.`,
		};
	}
	const current = watchedStateOf(found);
	if (current.state === "merged") return { seen: current, ends: true, wake: `Pull request ${name} merged, so the dashboard stopped watching it.` };
	const was = watch.seen;
	if (!was) return { seen: current, wake: null, ends: false };
	const changes: string[] = [];
	if (current.checks !== was.checks && current.checks !== "pending") changes.push(`checks ${words(was.checks)} → ${words(current.checks)}`);
	if (current.review !== was.review) changes.push(`review decision ${words(was.review)} → ${words(current.review)}`);
	if (current.unresolved !== was.unresolved) changes.push(`unresolved review threads ${was.unresolved} → ${current.unresolved}`);
	if (changes.length === 0) return { seen: current, wake: null, ends: false };
	return {
		seen: current,
		ends: false,
		wake: `Pull request ${name} changed: ${changes.join("; ")}. Act on it now. The dashboard keeps watching it until it merges or closes; call ${WATCH_PULL_REQUEST_TOOL} with stop to end the watch sooner.`,
	};
}

const sameState = (a: WatchedState | null, b: WatchedState | null): boolean =>
	a === b || (a !== null && b !== null && a.state === b.state && a.checks === b.checks && a.review === b.review && a.unresolved === b.unresolved);

export interface PullRequestWatchesDeps {
	file: PullRequestWatchesFile;
	/** The live sessions' roster rows, which give the caller's current session id. */
	hosts(): RosterHost[];
	/** Whether `request` starts a Bot's conversation, which gets no watch tool. */
	isBot(request: StartRequest): boolean;
	/** Sends `text` to session `sessionId` as a follow-up, resuming it when it ended. */
	wake(sessionId: string, text: string): Promise<void>;
	/** Whether this server wakes sessions: only the one that owns the unattended work does. */
	active(): boolean;
	now(): number;
}

export class PullRequestWatches {
	readonly #deps: PullRequestWatchesDeps;
	/** The last list {@link learn} read, which gives a new watch its starting state. */
	#latest: PullRequestList | null = null;

	constructor(deps: PullRequestWatchesDeps) {
		this.#deps = deps;
	}

	/** Whether any session watches a pull request, as another server may have saved, so the owner's activity check reads the list for it. */
	watching(): boolean {
		this.#deps.file.reload();
		return this.#deps.file.value.length > 0;
	}

	/** How `request` joins the server as session `instanceId`: with its own watch tool, unless it starts a Bot's conversation. */
	join(request: StartRequest, instanceId: string): SessionJoin {
		return { rpc: this.#deps.isBot(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#toolFor(instanceId)] }, attach() {} };
	}

	/**
	 * Steps every watch whose repository `list` answered for, saves what changed, and then wakes each session its step
	 * names, once: a save that fails wakes nothing, since the next list would wake for the same change again.
	 */
	learn(list: PullRequestList): void {
		this.#latest = list;
		if (!this.#deps.active()) return;
		const answered = new Map(list.repos.flatMap(repo => ("pullRequests" in repo ? [[repoKey(repo), repo.pullRequests] as const] : [])));
		const now = this.#deps.now();
		let wakes: [sessionId: string, text: string][] = [];
		try {
			this.#deps.file.update(watches => {
				wakes = [];
				let changed = false;
				const next = watches.flatMap(watch => {
					const prs = answered.get(repoKey(watch.pr));
					if (!prs) return [watch];
					const step = watchStep(
						watch,
						prs.find(pr => samePullRequest(pr, watch.pr)),
						now,
					);
					if (step.wake) wakes.push([watch.sessionId, step.wake]);
					if (step.ends) {
						changed = true;
						return [];
					}
					if (sameState(step.seen, watch.seen)) return [watch];
					changed = true;
					return [{ ...watch, seen: step.seen }];
				});
				return changed ? next : watches;
			});
		} catch (err) {
			console.error(`omp-agents: saving the pull request watches failed, so none woke: ${errorText(err)}`);
			return;
		}
		for (const [sessionId, text] of wakes) {
			this.#deps.wake(sessionId, text).catch((err: unknown) => console.error(`omp-agents: a pull request watch could not wake session ${sessionId}: ${errorText(err)}`));
		}
	}

	/** `pr` in the last list, when that list answered for its repository; `undefined` when it did not, `null` when it lacks it. */
	#lastSeen(pr: PullRequest): PullRequestSummary | null | undefined {
		const repo = this.#latest?.repos.find(item => repoKey(item) === repoKey(pr));
		if (!repo || !("pullRequests" in repo)) return undefined;
		return repo.pullRequests.find(item => samePullRequest(item, pr)) ?? null;
	}

	/** The watch tool of session `caller`. */
	#toolFor(caller: string): RpcHostTool {
		return {
			name: WATCH_PULL_REQUEST_TOOL,
			label: "Watch pull request",
			description: [
				"Watch a GitHub pull request so the dashboard wakes this session with one message when its checks finish passing or failing, its review decision changes, its unresolved review thread count changes, or it merges or closes.",
				"Use it instead of sleeping, polling gh, or scheduling follow-ups while you wait on a pull request; end your turn after calling it.",
				"The dashboard reads its pull request list every few minutes, the one its Pull requests page shows: your open pull requests and those asking for your review, in a workspace's repository.",
				"A merge or close ends the watch; `stop: true` ends it sooner.",
			].join(" "),
			parameters: {
				type: "object",
				properties: {
					url: { type: "string", description: "The pull request's address, such as https://github.com/owner/repo/pull/12." },
					stop: { type: "boolean", description: "True to stop watching it instead." },
				},
				required: ["url"],
				additionalProperties: false,
			},
			loadMode: "essential",
			execute: async ({ url, stop }) => {
				const pr = typeof url === "string" ? pullRequestOfUrl(url.trim()) : null;
				if (!pr) throw new Error("url must be a GitHub pull request address, such as https://github.com/owner/repo/pull/12.");
				if (stop !== undefined && typeof stop !== "boolean") throw new Error("stop must be true or false.");
				const host = this.#deps.hosts().find(row => row.instanceId === caller);
				if (!host) throw new Error("This session is not listed yet; try again in a moment.");
				const name = describe(pr);
				if (stop) {
					return this.#deps.file.apply({ op: "unwatch", sessionId: host.sessionId, pr }) ? `Stopped watching ${name}.` : `This session was not watching ${name}.`;
				}
				const last = this.#lastSeen(pr);
				if (last?.state === "merged") return `${name} already merged; there is nothing to watch.`;
				const seen = last ? watchedStateOf(last) : null;
				this.#deps.file.apply({ op: "watch", watch: { sessionId: host.sessionId, pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, since: this.#deps.now(), seen } });
				const start = seen
					? `As of the dashboard's last read: checks ${words(seen.checks)}, review decision ${words(seen.review)}, ${seen.unresolved} unresolved review threads; a change from this wakes you.`
					: "The dashboard has not listed it yet; its next read takes its state then as the starting point.";
				return `Watching ${name} (${prKey(pr)}). ${start} End your turn now; the message arrives as your next prompt.`;
			},
		};
	}
}
