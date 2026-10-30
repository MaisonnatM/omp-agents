/**
 * PR shepherd Bots: what their `fix_pull_request` and `queue_merge` tools ask of the server, and the job and routine a
 * new one starts with.
 */
import { isObject, type Parsed } from "../json";
import type { PullRequestActionId } from "../pull-request-actions";
import type { RoutineSpec } from "../routines";
import { type BotId, parseBotId } from "./bots";
import { parsePullRequest, type PullRequest } from "./github";
import { MERGE_METHODS, type MergeMethod } from "./source-control";

/** The quick actions a shepherd may start on a pull request: the ones that repair it, never a review. */
export const SHEPHERD_FIXES = ["fix-ci-and-conflicts", "fix-ci", "resolve-conflicts", "address-comments"] as const satisfies readonly PullRequestActionId[];

export type ShepherdFix = (typeof SHEPHERD_FIXES)[number];

/** How many times a shepherd may start one fix on one pull request before the server refuses and the Bot asks you. */
export const MAX_FIXES_PER_PULL_REQUEST = 2;

export type ShepherdChange =
	/** Starts `action`'s session on the pull request's branch, as the Pull requests page's quick action does. */
	| { op: "fix"; pr: PullRequest; action: ShepherdFix }
	/** Hands the pull request to the merge queue, which merges it with `method` once GitHub allows it. */
	| { op: "merge"; pr: PullRequest; method: MergeMethod };

/** What a shepherd's tool leaves for the server: one change from `botId`, the Bot that asks. */
export interface ShepherdRequest {
	botId: BotId;
	change: ShepherdChange;
}

/** A request a shepherd's tool left for the server, or `null`. */
export function parseShepherdRequest(value: unknown): Parsed<ShepherdRequest> {
	if (!isObject(value) || !isObject(value.change)) return null;
	const botId = parseBotId(value.botId);
	const { change } = value;
	const pr = isObject(change.pr) ? parsePullRequest(change.pr.owner, change.pr.repo, change.pr.number) : null;
	if (!botId || !pr) return null;
	switch (change.op) {
		case "fix":
			return SHEPHERD_FIXES.includes(change.action as ShepherdFix) ? { ok: { botId, change: { op: "fix", pr: pr.ok, action: change.action as ShepherdFix } } } : null;
		case "merge":
			return MERGE_METHODS.includes(change.method as MergeMethod) ? { ok: { botId, change: { op: "merge", pr: pr.ok, method: change.method as MergeMethod } } } : null;
		default:
			return null;
	}
}

export const SHEPHERD_NAME = "Shepherd";

export const SHEPHERD_JOB = [
	"Get my approved pull requests merged.",
	"When a routine run names a pull request, read it with `gh pr view` and act only when I wrote it and it is approved.",
	"Fix one problem at a time with `fix_pull_request`: conflicts first, then failing checks, then review comments.",
	"Treat bot review comments as claims to check against the code, and ask me before acting on anything about security, auth, billing, or data.",
	"Once nothing blocks it, hand it to the merge queue with `queue_merge` and squash.",
	"When the dashboard refuses a fix or a merge, tell me why and what you need from me.",
].join("\n");

/** The routine a new shepherd starts with: a run whenever one of your pull requests becomes your move. */
export const shepherdRoutine = (botId: BotId): RoutineSpec => ({
	id: `${botId}-pull-requests`,
	botId,
	name: "Pull request changed",
	schedules: [],
	triggers: [{ kind: "pull-request" }],
	task: { kind: "prompt", prompt: "Check each pull request this run names, and fix or queue the approved ones as your job says." },
	enabled: true,
});
