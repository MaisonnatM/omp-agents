/**
 * Whether a pull request's head is what a reviewer approved: its diff from where it leaves its base has the same stable
 * `git patch-id` as an approved commit's, so a rebase keeps an approval and a new change does not.
 */
import { dataOf, ghGraphql } from "./github";
import { git } from "./git";
import { isObject } from "./json";
import { runChecked } from "./proc";
import type { PullRequest } from "./shared/github";

/** How long the fetch of the commits to compare may take. */
const FETCH_TIMEOUT_MS = 60_000;

/** The stable patch id of `commit`'s changes since it left `base`, in the repository at `cwd`; empty for a commit with no changes. */
export async function patchId(cwd: string, base: string, commit: string): Promise<string> {
	const from = (await git(cwd, "merge-base", base, commit)).trim();
	const diff = await git(cwd, "diff", "--no-color", from, commit);
	const id = await runChecked(["git", "-C", cwd, "patch-id", "--stable"], { input: diff, timeoutMs: 10_000 });
	return id.split(" ")[0] ?? "";
}

const APPROVALS = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
		headRefOid baseRefName reviews(states: APPROVED, last: 50) { nodes { commit { oid } } }
	} }
}`;

/** The head, the base branch, and the commits reviewers approved of `pr`, newest last. */
async function approvals(pr: PullRequest): Promise<{ head: string; base: string; approved: string[] }> {
	const node = (dataOf(await ghGraphql(APPROVALS, { owner: pr.owner, repo: pr.repo, number: pr.number })).repository as { pullRequest?: unknown } | null)?.pullRequest;
	if (!isObject(node) || typeof node.headRefOid !== "string" || typeof node.baseRefName !== "string") throw new Error("GitHub did not answer for the pull request");
	const reviews = isObject(node.reviews) && Array.isArray(node.reviews.nodes) ? node.reviews.nodes : [];
	const approved = reviews.flatMap(review => (isObject(review) && isObject(review.commit) && typeof review.commit.oid === "string" ? [review.commit.oid] : []));
	return { head: node.headRefOid, base: node.baseRefName, approved };
}

/** `null` when `pr`'s head has the changes of a commit a reviewer approved, read in its checkout at `cwd`; else why not. */
export async function unapprovedChange(cwd: string, pr: PullRequest): Promise<string | null> {
	const { head, base, approved } = await approvals(pr);
	if (approved.length === 0) return "no reviewer approved a commit of it";
	if (approved.includes(head)) return null;
	await runChecked(["git", "-C", cwd, "fetch", "--quiet", "origin", base, head, ...new Set(approved)], { timeoutMs: FETCH_TIMEOUT_MS });
	const target = `origin/${base}`;
	const now = await patchId(cwd, target, head);
	for (const commit of new Set(approved)) if ((await patchId(cwd, target, commit)) === now) return null;
	return "its head changes code no reviewer approved";
}
