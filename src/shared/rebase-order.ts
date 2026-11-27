/**
 * Which of your pull requests a rebase onto its base applies to, and in what order a repository's rebase: what the
 * page's **Rebase N behind** queues and what **Keep rebased** rebases on the server.
 */
import type { PullRequestSummary } from "./github";

/** The bottom of `pr`'s stack among `byHead`, the pull requests by head branch, and how many there are from `pr` down to it, both counted. */
export function chainBelow(pr: PullRequestSummary, byHead: ReadonlyMap<string, PullRequestSummary>): { bottom: PullRequestSummary; size: number } {
	// GitHub cannot report a cycle of bases, but one must not hang the page.
	const seen = new Set([pr]);
	let bottom = pr;
	for (let below = byHead.get(pr.stackedOn ?? ""); below && !seen.has(below); below = byHead.get(below.stackedOn ?? "")) {
		seen.add(below);
		bottom = below;
	}
	return { bottom, size: seen.size };
}

/** Your open or draft pull request without conflicts, whose branch a rebase may push; one with conflicts gets **Resolve conflicts** instead. */
const rebasable = (pr: PullRequestSummary): boolean => pr.role === "author" && pr.state !== "merged" && !pr.conflicts;

/** Whether **Rebase on** its base applies to `pr`: your pull request, behind its base and without conflicts. */
export const rebaseApplies = (pr: PullRequestSummary): boolean => rebasable(pr) && pr.behind;

/**
 * What **Rebase behind** rebases in one repository's `pullRequests`, in order: those {@link rebaseApplies} to, and every
 * rebasable one stacked on one of them, which falls behind only once the one below it is pushed. The bottom of a stack
 * comes first; otherwise they keep the order of `pullRequests`.
 */
export function rebaseOrder(pullRequests: readonly PullRequestSummary[]): PullRequestSummary[] {
	const above = Map.groupBy(pullRequests.filter(pr => rebasable(pr) && pr.stackedOn !== null), pr => pr.stackedOn);
	const chosen = new Set(pullRequests.filter(rebaseApplies));
	// A set's loop also visits what it adds, and adds nothing twice, so a cycle of bases ends.
	for (const pr of chosen) for (const child of above.get(pr.head) ?? []) chosen.add(child);
	const byHead = new Map([...chosen].map(pr => [pr.head, pr]));
	return pullRequests.filter(pr => chosen.has(pr)).map(pr => ({ pr, depth: chainBelow(pr, byHead).size })).sort((a, b) => a.depth - b.depth).map(({ pr }) => pr);
}
