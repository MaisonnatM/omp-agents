/** What a pull request waits on next, which the Pull requests page ranks its rows by and the bell notifies of when the move is yours. */
import { mergesNow, type PullRequestList, type PullRequestSummary, type PullRequest, type PullRequestDetail, type Repo } from "./github";
import { type HostStatus, type RosterHost, worksOn } from "./sessions";
import type { MergeMethod } from "./source-control";

export type MoveId = "review" | "merge" | "fix-ci" | "rebase" | "reply" | "answer" | "agent" | "in-review" | "checks-running" | "draft" | "merged";

/** The moves that wait on you, each of which the bell notifies of. */
export const YOUR_MOVES = ["review", "merge", "fix-ci", "rebase", "reply"] as const satisfies readonly MoveId[];
export type YourMove = (typeof YOUR_MOVES)[number];

/** Whether `move` waits on you, so a pull request trigger fires on it and the bell rings for it. */
const isYourMove = (move: MoveId): move is YourMove => (YOUR_MOVES as readonly MoveId[]).includes(move);

/** A running session's turn on a pull request: it works, or it asks you something. */
export type AgentState = Extract<HostStatus, "working" | "needs-input">;

/** Where the running sessions linked to a pull request stand, `needs-input` before `working`; `null` when none works on it or asks. */
export type AgentOn = (pr: PullRequest) => AgentState | null;

/** Where the running sessions on each pull request stand. An idle session's turn ended, so the move is back with you; an unknown one counts as idle. */
export const agentOn = (hosts: RosterHost[]): AgentOn => pr => {
	const statuses = new Set(hosts.filter(host => worksOn(host, { kind: "pull-request", pr })).map(host => host.status));
	return statuses.has("needs-input") ? "needs-input" : statuses.has("working") ? "working" : null;
};

/** What decides whether a pull request can merge, as a list entry and the details both carry it. */
type MergeFacts = Pick<PullRequestSummary, "review" | "checks" | "conflicts" | "unresolved"> & { state: PullRequestDetail["state"] };

/** Some review thread waits for a resolution, or GitHub listed too few threads to tell. */
export const hasOpenThreads = ({ unresolved }: Pick<MergeFacts, "unresolved">): boolean => unresolved.count > 0 || !unresolved.exact;

/** Open, approved or needing no review, its checks passed or absent, no conflicts, and no review thread left open. */
export const readyToMerge = (facts: MergeFacts): boolean =>
	facts.state === "open" && (facts.review === "approved" || facts.review === "none") && !facts.conflicts && (facts.checks === "passing" || facts.checks === "none") && !hasOpenThreads(facts);

/** Ready to merge but for checks still running, so a merge queued now lands once they pass. */
export const readyOnceChecksPass = (facts: MergeFacts): boolean => facts.checks === "pending" && readyToMerge({ ...facts, checks: "passing" });

/**
 * The facts a pull request's moves and quick actions follow on its details page: who you are to it from the list entry `listed`,
 * and its state, review, checks, conflicts, and threads from `detail` once read, so the header and the Summary agree.
 * `null` when the details found it closed, which no move or quick action applies to.
 */
export function actionFacts(listed: PullRequestSummary, detail: PullRequestDetail | null): PullRequestSummary | null {
	if (!detail) return listed;
	if (detail.state === "closed") return null;
	const { state, review, checks, conflicts, unresolved } = detail;
	return { ...listed, state, review, checks, conflicts, unresolved };
}

/** What `pr` waits on next, given where the sessions on it stand. */
export function moveOf(pr: PullRequestSummary, agent: AgentState | null): MoveId {
	if (pr.state === "merged") return "merged";
	if (agent === "needs-input") return "answer";
	if (agent === "working") return "agent";
	if (pr.role === "reviewer") return "review";
	// What follows is your own open or draft pull request: a blocker you can fix comes before whether it is a draft.
	if (pr.conflicts) return "rebase";
	if (pr.checks === "failing") return "fix-ci";
	if (pr.review === "changes-requested" || hasOpenThreads(pr)) return "reply";
	if (pr.state === "draft") return "draft";
	if (readyToMerge(pr)) return "merge";
	if (pr.checks === "pending") return "checks-running";
	return "in-review";
}

/** A pull request whose next move is yours, by that move, with the repository it is in and the workspaces of that repository. */
export interface YourPullRequest {
	repo: Repo & { cwds: string[] };
	pr: PullRequestSummary;
	move: YourMove;
}

/**
 * The repositories of `list` GitHub answered for, and each of their pull requests whose next move is yours, read with
 * the sessions on it, as the bell and the routines' pull request trigger both read them.
 */
export function yourMoves(list: PullRequestList, agent: AgentOn): { answered: (Repo & { cwds: string[] })[]; yours: YourPullRequest[] } {
	const answered = list.repos.flatMap(repo => ("error" in repo ? [] : [repo]));
	const yours = answered.flatMap(repo =>
		repo.pullRequests.flatMap(pr => {
			const move = moveOf(pr, agent(pr));
			return isYourMove(move) ? [{ repo, pr, move }] : [];
		}),
	);
	return { answered, yours };
}

export type PrimaryControl =
	| { kind: "merged" }
	| { kind: "closed" }
	| { kind: "none" }
	| { kind: "resolve-conflicts" }
	| { kind: "ready-for-review" }
	| { kind: "auto-merge-armed"; method: MergeMethod }
	| { kind: "enable-auto-merge"; method: MergeMethod }
	| { kind: "merge"; method: MergeMethod };

export function primaryControl(
	detail: Pick<PullRequestDetail, "state" | "conflicts" | "checks" | "mergeState">,
	method: MergeMethod | null,
	armed: MergeMethod | null,
): PrimaryControl {
	if (detail.state === "merged") return { kind: "merged" };
	if (detail.state === "closed") return { kind: "closed" };
	if (detail.conflicts) return { kind: "resolve-conflicts" };
	if (detail.state === "draft") return { kind: "ready-for-review" };
	if (armed) return { kind: "auto-merge-armed", method: armed };
	if (!method) return { kind: "none" };
	return { kind: mergesNow(detail) ? "merge" : "enable-auto-merge", method };
}
