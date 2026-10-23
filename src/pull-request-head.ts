/** What **Check out** and **Rebase on main** read of a pull request on GitHub, and the workspace both refuse. */
import { ghRest, repoOf } from "./github";
import { isObject, str } from "./json";
import type { PullRequest } from "./shared/github";

export interface PullRequestHead {
	title: string;
	/** The head branch's name in the repository it lives in. */
	ref: string;
	oid: string;
	/** The branch it merges into. */
	base: string;
	/** The head branch lives in a fork. */
	fork: boolean;
}

export async function headOf(pr: PullRequest): Promise<PullRequestHead> {
	const answer = await ghRest(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
	const head = isObject(answer) && isObject(answer.head) ? answer.head : null;
	const base = isObject(answer) && isObject(answer.base) ? answer.base : null;
	const title = isObject(answer) ? str(answer.title) : undefined;
	const baseRef = base ? str(base.ref) : undefined;
	if (title === undefined || !head || !base || !baseRef) throw new Error(`GitHub answered incomplete pull request data for ${pr.owner}/${pr.repo}#${pr.number}.`);
	const ref = str(head.ref);
	const oid = str(head.sha);
	if (!ref || !oid) throw new Error(`GitHub answered no head branch for ${pr.owner}/${pr.repo}#${pr.number}.`);
	const fullName = (side: Record<string, unknown>) => (isObject(side.repo) ? str(side.repo.full_name) : undefined);
	return { title, ref, oid, base: baseRef, fork: fullName(head) !== fullName(base) };
}

/** Refuses a `cwd` whose `origin` is not `pr`'s repository. */
export async function assertWorkspaceOf(cwd: string, pr: PullRequest): Promise<void> {
	const repo = await repoOf(cwd);
	if (!repo || repo.owner.toLowerCase() !== pr.owner.toLowerCase() || repo.repo.toLowerCase() !== pr.repo.toLowerCase()) throw new Error("The selected workspace is not this pull request's repository.");
}
