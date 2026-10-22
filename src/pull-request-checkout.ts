/**
 * **Check out** on a pull request's details: its branch in a worktree of its own with a new session on it, or in the
 * checkout the page knows through `gh pr checkout`. Neither moves uncommitted work or a branch with commits of its own.
 */
import { git, worktreesOf } from "./git";
import { ghRest, repoOf } from "./github";
import { isObject, str } from "./json";
import { run, runChecked } from "./proc";
import { type CheckedOutPullRequest, type PullRequest, type PullRequestCheckout, pullRequestUrl } from "./shared/github";
import { newSessionRequest, type NewSessionRequest, type StartResult } from "./shared/sessions";

const FETCH_TIMEOUT_MS = 120_000;

/** Starts a new session, as a page's `start` does. */
export type StartSession = (request: NewSessionRequest) => Promise<StartResult>;

/** What the checkout reads of the pull request on GitHub. */
interface PullRequestHead {
	title: string;
	/** The head branch's name in the repository it lives in. */
	ref: string;
	oid: string;
	/** The head branch lives in a fork. */
	fork: boolean;
}

async function headOf(pr: PullRequest): Promise<PullRequestHead> {
	const answer = await ghRest(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
	const head = isObject(answer) && isObject(answer.head) ? answer.head : null;
	const base = isObject(answer) && isObject(answer.base) ? answer.base : null;
	const title = isObject(answer) ? str(answer.title) : undefined;
	const ref = str(head?.ref);
	const oid = str(head?.sha);
	if (title === undefined || !ref || !oid || !base) throw new Error(`GitHub answered no head branch for ${pr.owner}/${pr.repo}#${pr.number}.`);
	const fullName = (side: Record<string, unknown>) => (isObject(side.repo) ? str(side.repo.full_name) : undefined);
	return { title, ref, oid, fork: fullName(head!) !== fullName(base) };
}

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
 * start adds. A branch not checked out anywhere first takes the pull request's head with a fetch that only fast-forwards.
 * A fork's branch is `pr-<number>/<name>`, since its name could be one the repository uses.
 */
async function checkOutInWorktree(request: PullRequestCheckout, head: PullRequestHead, start: StartSession): Promise<CheckedOutPullRequest> {
	const { cwd } = request;
	const branch = head.fork ? `pr-${request.number}/${head.ref}` : head.ref;
	const holder = (await worktreesOf(cwd)).find(worktree => worktree.prunable === null && worktree.branch === branch);
	if (holder?.main) throw new Error("This PR branch is already checked out in the main repo. Use In this repository, or switch the main repo off that branch before creating a worktree session.");
	if (!holder) {
		await runChecked(["git", "-C", cwd, "fetch", "--quiet", "origin", `refs/pull/${request.number}/head:refs/heads/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
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
	const repo = await repoOf(request.cwd);
	if (!repo || repo.owner.toLowerCase() !== request.owner.toLowerCase() || repo.repo.toLowerCase() !== request.repo.toLowerCase()) throw new Error("The selected workspace is not this pull request's repository.");
	const head = await headOf(request);
	return request.place === "here" ? checkOutHere(request, head) : checkOutInWorktree(request, head, start);
}
