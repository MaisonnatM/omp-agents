/**
 * **Rebase on main** on the Pull requests page: a pull request's branch rebased onto its base and force-pushed with a
 * lease on the commit it fetched, through the repository's pre-push hook, its checks. A conflict or a refused push
 * leaves every branch as it was.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commonDir, git, worktreesOf } from "./git";
import { ghRest, repoOf } from "./github";
import { isObject, str } from "./json";
import { childEnv, run, type RunResult } from "./proc";
import { SerialLane } from "./serial-lane";
import type { PullRequest, PullRequestRebase, RebasedPullRequest } from "./shared/github";

const GIT_TIMEOUT_MS = 120_000;
/** The push runs the pre-push hook, which may run a repository's whole test suite. */
const PUSH_TIMEOUT_MS = 20 * 60_000;

/** The pull request's branch, `head`, and the branch it merges into, `base`, both in its repository. */
interface Branches {
	head: string;
	base: string;
}

async function branchesOf(pr: PullRequest): Promise<Branches> {
	const answer = await ghRest(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
	const head = isObject(answer) && isObject(answer.head) ? answer.head : null;
	const base = isObject(answer) && isObject(answer.base) ? answer.base : null;
	const headRef = head && str(head.ref);
	const baseRef = base && str(base.ref);
	if (!head || !base || !headRef || !baseRef) throw new Error(`GitHub answered incomplete pull request data for ${pr.owner}/${pr.repo}#${pr.number}.`);
	const fullName = (side: Record<string, unknown>) => (isObject(side.repo) ? str(side.repo.full_name) : undefined);
	if (fullName(head) !== fullName(base)) throw new Error(`Pull request #${pr.number}'s branch is in a fork, which this dashboard does not push to.`);
	return { head: headRef, base: baseRef };
}

async function commitOf(dir: string, ref: string): Promise<string | null> {
	const { stdout, code } = await run(["git", "-C", dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
	return code === 0 ? stdout.trim() : null;
}

const isAncestor = async (dir: string, ancestor: string, of: string): Promise<boolean> => (await run(["git", "-C", dir, "merge-base", "--is-ancestor", ancestor, of])).code === 0;

/**
 * `git` in `dir`, killed after `timeoutMs`, with no prompt or editor and without the variables the server sets for
 * itself, which `childEnv` leaves out, since a hook may start a server of its own.
 */
function gitRun(dir: string, timeoutMs: number, ...args: string[]): Promise<RunResult> {
	const child = childEnv();
	const unset = Object.keys(process.env).filter(name => !(name in child)).flatMap(name => ["-u", name]);
	return run(["env", ...unset, "git", "-C", dir, ...args], { timeoutMs, env: { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } });
}

/** The last lines git wrote to stderr, which hold a hook's own output. */
function lastLines({ stderr, code }: RunResult): string {
	return stderr.split("\n").map(line => line.trimEnd()).filter(line => line.trim()).slice(-12).join("\n") || `git exited ${code}`;
}

/** Rebases the commit checked out in `dir` onto `origin/<base>` and pushes it to `head`, unless `origin`'s `head` moved past `old`. */
async function rebaseAndPush(dir: string, { head, base }: Branches, old: string): Promise<RebasedPullRequest> {
	// `--fork-point` reads `origin/<base>`'s reflog, so a branch stacked on one that was just rebased replays only its own commits.
	const rebase = await gitRun(dir, GIT_TIMEOUT_MS, "rebase", "--fork-point", "--no-update-refs", "--no-autostash", `refs/remotes/origin/${base}`);
	if (rebase.code !== 0) {
		const files = (await git(dir, "diff", "--name-only", "--diff-filter=U")).split("\n").filter(Boolean);
		if (files.length === 0) {
			await run(["git", "-C", dir, "rebase", "--abort"]);
			throw new Error(lastLines(rebase));
		}
		await git(dir, "rebase", "--abort");
		return { kind: "conflict", files, branch: head, onto: base };
	}
	const push = await gitRun(dir, PUSH_TIMEOUT_MS, "push", `--force-with-lease=refs/heads/${head}:${old}`, "origin", `HEAD:refs/heads/${head}`);
	if (push.code !== 0) throw new Error(lastLines(push));
	return { kind: "rebased", branch: head, onto: base };
}

/**
 * Rebases `branches.head` onto `branches.base` as `origin` has them, in the worktree that has the branch checked out,
 * else in a detached worktree of its own, which it removes after. A local branch moves only when the push succeeds.
 */
async function rebaseBranch(cwd: string, branches: Branches, number: number): Promise<RebasedPullRequest> {
	const { head, base } = branches;
	const origin = (branch: string) => `refs/remotes/origin/${branch}`;
	const fetched = await gitRun(cwd, GIT_TIMEOUT_MS, "fetch", "--no-tags", "origin", `+refs/heads/${base}:${origin(base)}`, `+refs/heads/${head}:${origin(head)}`);
	if (fetched.code !== 0) throw new Error(lastLines(fetched));
	const old = await commitOf(cwd, origin(head));
	if (!old) throw new Error(`origin has no branch \`${head}\`.`);
	if (await isAncestor(cwd, origin(base), old)) return { kind: "current", branch: head, onto: base };

	const holder = (await worktreesOf(cwd)).find(worktree => worktree.prunable === null && worktree.branch === head);
	const local = holder?.head ?? (await commitOf(cwd, `refs/heads/${head}`));
	if (local && !(await isAncestor(cwd, local, old))) throw new Error(`Local branch \`${head}\` has commits pull request #${number} does not. Push or drop them before rebasing it.`);

	if (holder) {
		if ((await git(holder.path, "status", "--porcelain", "--untracked-files=no")).trim()) throw new Error(`${holder.path} has uncommitted changes on \`${head}\`. Commit or stash them before rebasing pull request #${number}.`);
		// git refuses to fast-forward during a merge, cherry-pick, or revert, which the reset below would discard.
		const forwarded = await gitRun(holder.path, GIT_TIMEOUT_MS, "merge", "--ff-only", "--quiet", old);
		if (forwarded.code !== 0) throw new Error(lastLines(forwarded));
		let outcome: RebasedPullRequest | null = null;
		try {
			outcome = await rebaseAndPush(holder.path, branches, old);
			return outcome;
		} finally {
			if (outcome?.kind !== "rebased") await git(holder.path, "reset", "--hard", "--quiet", holder.head);
		}
	}

	const dir = await mkdtemp(join(tmpdir(), "omp-agents-rebase-"));
	try {
		const added = await gitRun(cwd, GIT_TIMEOUT_MS, "worktree", "add", "--detach", "--quiet", dir, old);
		if (added.code !== 0) throw new Error(lastLines(added));
		const outcome = await rebaseAndPush(dir, branches, old);
		if (outcome.kind === "rebased" && local) await git(cwd, "update-ref", `refs/heads/${head}`, (await git(dir, "rev-parse", "HEAD")).trim(), local);
		return outcome;
	} finally {
		await run(["git", "-C", cwd, "worktree", "remove", "--force", dir]);
		await rm(dir, { recursive: true, force: true });
	}
}

/** One lane per repository, so two rebases never share its refs or worktrees. */
const lanes = new Map<string, SerialLane>();

/** Rebases `request`'s pull request onto its base and pushes it; refuses a `cwd` whose `origin` is another repository. */
export async function rebasePullRequest(request: PullRequestRebase): Promise<RebasedPullRequest> {
	const [repo, branches] = await Promise.all([repoOf(request.cwd), branchesOf(request)]);
	if (!repo || repo.owner.toLowerCase() !== request.owner.toLowerCase() || repo.repo.toLowerCase() !== request.repo.toLowerCase()) throw new Error("The selected workspace is not this pull request's repository.");
	const key = await commonDir(request.cwd);
	let lane = lanes.get(key);
	if (!lane) lanes.set(key, (lane = new SerialLane()));
	return lane.run(() => rebaseBranch(request.cwd, branches, request.number));
}
