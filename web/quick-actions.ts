/**
 * The quick actions of the Pull requests page: which pull request each applies to, and the prompt that starts its
 * session. The pull request actions live in `src/pull-request-actions.ts`, which routines share.
 */
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, type QuickAction } from "../src/pull-request-actions";
import type { BranchChoice } from "../src/shared/git";
import { type PullRequestSummary, type PullRequest, samePullRequest } from "../src/shared/github";
import type { NewSessionRequest, WorkItem } from "../src/shared/sessions";

export type QuickActionId = PullRequestActionId;

/** What a quick start works on, with the action it runs there. */
export type QuickSubject = { kind: "pull-request"; pr: PullRequest; action: PullRequestActionId };

/** A quick start's request. Defined here so the start list can hold one without this file importing the start list. */
export type QuickOp = {
	kind: "quick";
	cwd: string;
	branch: BranchChoice | null;
	prompt: string;
	subject: QuickSubject;
	skill: string | null;
};

/** What the server links the session that `subject` starts to: its pull request as its subject; a Review start saves a review draft of its pull request, and a fix goes to the session that owns its pull request. */
export function startTarget(subject: QuickSubject): Pick<NewSessionRequest, "subject" | "reviewDraft" | "reachOwner"> {
	return { subject: { kind: "pull-request", pr: subject.pr }, reviewDraft: subject.action === "review", reachOwner: PULL_REQUEST_ACTIONS[subject.action].reachesOwner };
}

/** `quick` when it works on `item`, else `null`: the start whose failure `item`'s details show. */
export const quickOn = <T extends { op: QuickOp }>(quick: T | null, item: WorkItem): T | null => (quick && samePullRequest(quick.op.subject.pr, item.pr) ? quick : null);

/** The action of the quick start under way on `item`, if any. */
export function pendingOf(quick: ({ op: QuickOp } & { phase: string }) | null, item: WorkItem): QuickActionId | null {
	const on = quickOn(quick, item);
	return on?.phase === "starting" ? on.op.subject.action : null;
}

/** Every quick action's label and description, by id, for the menus and buttons that offer them. */
export const QUICK_ACTIONS: Record<QuickActionId, Pick<QuickAction<unknown>, "label" | "description">> = PULL_REQUEST_ACTIONS;

/** The branch choice of a quick start that works on `branch`, `null` to start in the workspace as it is. */
const workBranch = (branch: string | null): QuickOp["branch"] => (branch ? { kind: "work", name: branch } : null);

/** The start of `action` on `pr`, from `cwd` and in the PR branch's worktree when the action changes it, through the pinned `skill` when one is pinned. */
export const pullRequestStart = (pr: PullRequestSummary, action: PullRequestActionId, cwd: string, skill: string | null): QuickOp => ({
	kind: "quick",
	cwd,
	branch: workBranch(PULL_REQUEST_ACTIONS[action].branch(pr)),
	prompt: PULL_REQUEST_ACTIONS[action].prompt(pr),
	subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number }, action },
	skill,
});
