/** What a pull request waits on next, which the Pull requests page ranks its rows by and the bell notifies of when the move is yours. */
import type { PullRequestSummary, PullRequest, PullRequestDetail } from "./github";
import { type HostStatus, type RosterHost, worksOn } from "./sessions";

export type MoveId = "review" | "merge" | "fix-ci" | "rebase" | "reply" | "answer" | "agent" | "in-review" | "checks-running" | "draft" | "merged";

/** The moves that wait on you, each of which the bell notifies of. */
export const YOUR_MOVES = ["review", "merge", "fix-ci", "rebase", "reply"] as const satisfies readonly MoveId[];
export type YourMove = (typeof YOUR_MOVES)[number];

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
