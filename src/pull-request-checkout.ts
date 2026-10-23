/**
 * **Check out** on a pull request's details: its branch in a worktree of its own with a new session on it, or in the
 * checkout the page knows through `gh pr checkout`. Neither moves uncommitted work or a branch with commits of its own.
 */
import { git, holderOf } from "./git";
import { run, runChecked } from "./proc";
import { assertWorkspaceOf, headOf, type PullRequestHead } from "./pull-request-head";
import { type CheckedOutPullRequest, type PullRequestCheckout, pullRequestUrl } from "./shared/github";
import { newSessionRequest, type NewSessionRequest, type StartResult } from "./shared/sessions";

const FETCH_TIMEOUT_MS = 120_000;

/** Starts a new session, as a page's `start` does. */
export type StartSession = (request: NewSessionRequest) => Promise<StartResult>;

/** `gh pr checkout` in `cwd`, refused while tracked files there have uncommitted changes. */
async function checkOutHere(request: PullRequestCheckout, head: PullRequestHead): Promise<CheckedOutPullRequest> {
	const { cwd } = request;
	if ((await git(cwd, "status", "--porcelain", "--untracked-files=no")).trim()) throw new Error(`This repository has uncommitted changes. Commit or stash them before checking out pull request #${request.number} here, or check it out in its own folder.`);
	await runChecked(["gh", "pr", "checkout", String(request.number), "-R", `${request.owner}/${request.repo}`], { cwd, timeoutMs: FETCH_TIMEOUT_MS });
	const [branch, oid] = await Promise.all([git(cwd, "symbolic-ref", "--quiet", "--short", "HEAD"), git(cwd, "rev-parse", "HEAD")]);
	return { place: "here", branch: branch.trim(), onHead: oid.trim() === head.oid };
}

/**
 * A new session on the pull request's branch, in the linked worktree that has it checked out, else in a new one the
 * start adds. A branch not checked out anywhere first takes the pull request's head only when it can fast-forward.
 * A fork's branch is `pr-<number>/<name>`, since its name could be one the repository uses.
 */
async function checkOutInWorktree(request: PullRequestCheckout, head: PullRequestHead, start: StartSession): Promise<CheckedOutPullRequest> {
	const { cwd } = request;
	const branch = head.fork ? `pr-${request.number}/${head.ref}` : head.ref;
	const holder = await holderOf(cwd, branch);
	if (holder?.main) throw new Error("This PR branch is already checked out in the main repo. Use In this repository, or switch the main repo off that branch before creating a worktree session.");
	if (!holder) {
		try {
			await runChecked(["git", "-C", cwd, "fetch", "--no-tags", "origin", `refs/pull/${request.number}/head:refs/heads/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
		} catch (error) {
			if (error instanceof Error && error.message.includes("(non-fast-forward)")) throw new Error(`Local branch \`${branch}\` has commits pull request #${request.number} does not. Move them off it or delete it before checking the pull request out in its own worktree.`);
			throw error;
		}
		const tracked = await run(["git", "-C", cwd, "config", "--get", `branch.${branch}.merge`]);
		if (!head.fork && tracked.code !== 0) {
			await git(cwd, "config", `branch.${branch}.remote`, "origin");
			await git(cwd, "config", `branch.${branch}.merge`, `refs/heads/${head.ref}`);
		}
	}
	const oid = holder ? holder.head : (await git(cwd, "rev-parse", `refs/heads/${branch}`)).trim();
	// omp writes a new session's file only with its first reply, so the session starts on a prompt.
	const prompt = `Pull request ${pullRequestUrl(request)} ("${head.title}") is checked out in this worktree, on branch \`${branch}\`. Read its description and diff (\`gh pr view ${request.number} -R ${request.owner}/${request.repo}\`, \`gh pr diff ${request.number} -R ${request.owner}/${request.repo}\`), sum up what it changes in a few lines, then wait for what I ask next.`;
	const started = await start(newSessionRequest(cwd, prompt, { branch: { kind: "existing", name: branch }, skill: request.skill, subject: { kind: "pull-request", pr: { owner: request.owner, repo: request.repo, number: request.number } } }));
	if (!started.ok) throw new Error(started.error);
	return { place: "worktree", branch, onHead: oid === head.oid, instanceId: started.instanceId };
}

/** Checks out `request`'s pull request at its place; refuses a `cwd` whose `origin` is another repository. */
export async function checkOutPullRequest(request: PullRequestCheckout, start: StartSession): Promise<CheckedOutPullRequest> {
	const [, head] = await Promise.all([assertWorkspaceOf(request.cwd, request), headOf(request)]);
	return request.place === "here" ? checkOutHere(request, head) : checkOutInWorktree(request, head, start);
}
