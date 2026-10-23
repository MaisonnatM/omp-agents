/**
 * **Rebase on main** on the Pull requests page: a pull request's branch rebased onto its base and force-pushed with a
 * lease on the commit it fetched, through the repository's pre-push hook, its checks. A conflict or a refused push
 * leaves every branch as it was.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commonDir, git, holderOf } from "./git";
import { run, type RunResult } from "./proc";
import { assertWorkspaceOf, headOf, type PullRequestHead } from "./pull-request-head";
import { SerialLane } from "./serial-lane";
import type { PullRequestRebase, RebasedPullRequest } from "./shared/github";

const GIT_TIMEOUT_MS = 120_000;
/** The push runs the pre-push hook, which may run a repository's whole test suite. */
const PUSH_TIMEOUT_MS = 20 * 60_000;

async function commitOf(dir: string, ref: string): Promise<string | null> {
	const { stdout, code } = await run(["git", "-C", dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
	return code === 0 ? stdout.trim() : null;
}

const isAncestor = async (dir: string, ancestor: string, of: string): Promise<boolean> => (await run(["git", "-C", dir, "merge-base", "--is-ancestor", ancestor, of])).code === 0;

/**
 * `git` in `dir`, killed after `timeoutMs`, with no prompt or editor and without the variables the server sets for
 * itself, since a hook may start a server of its own.
 */
function gitRun(dir: string, timeoutMs: number, ...args: string[]): Promise<RunResult> {
	return run(["git", "-C", dir, ...args], { timeoutMs, child: true, env: { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } });
}

/** The last lines git wrote to stderr, which hold a hook's own output. */
function lastLines({ stderr, code }: RunResult): string {
	return stderr.split("\n").map(line => line.trimEnd()).filter(line => line.trim()).slice(-12).join("\n") || `git exited ${code}`;
}

/** Rebases the commit checked out in `dir` onto `origin/<base>` and pushes it to `head`, unless `origin`'s `head` moved past `old`. */
async function rebaseAndPush(dir: string, { ref: head, base }: PullRequestHead, old: string): Promise<RebasedPullRequest> {
	// `--fork-point` reads `origin/<base>`'s reflog, so a branch stacked on one that was just rebased replays only its own commits.
	const rebase = await gitRun(dir, GIT_TIMEOUT_MS, "rebase", "--fork-point", "--no-update-refs", "--no-autostash", `refs/remotes/origin/${base}`);
	if (rebase.code !== 0) {
		const files = (await git(dir, "diff", "--name-only", "--diff-filter=U")).split("\n").filter(Boolean);
		await run(["git", "-C", dir, "rebase", "--abort"]);
		if (files.length === 0) throw new Error(lastLines(rebase));
		return { kind: "conflict", files, branch: head, onto: base };
	}
	const push = await gitRun(dir, PUSH_TIMEOUT_MS, "push", `--force-with-lease=refs/heads/${head}:${old}`, "origin", `HEAD:refs/heads/${head}`);
	if (push.code !== 0) throw new Error(lastLines(push));
	return { kind: "rebased", branch: head, onto: base };
}

/**
 * Rebases the pull request's branch onto its base as `origin` has them, in the worktree that has the branch checked out,
 * else in a detached worktree of its own, which it removes after. A local branch moves only when the push succeeds.
 */
async function rebaseBranch(cwd: string, branches: PullRequestHead, number: number): Promise<RebasedPullRequest> {
	const { ref: head, base } = branches;
	const origin = (branch: string) => `refs/remotes/origin/${branch}`;
	const fetched = await gitRun(cwd, GIT_TIMEOUT_MS, "fetch", "--no-tags", "origin", `+refs/heads/${base}:${origin(base)}`, `+refs/heads/${head}:${origin(head)}`);
	if (fetched.code !== 0) throw new Error(lastLines(fetched));
	const old = await commitOf(cwd, origin(head));
	if (!old) throw new Error(`origin has no branch \`${head}\`.`);
	if (await isAncestor(cwd, origin(base), old)) return { kind: "current", branch: head, onto: base };

	const holder = await holderOf(cwd, head);
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

/** One lane per repository while it has rebases running or waiting, so two rebases never share its refs or worktrees. */
const lanes = new Map<string, SerialLane>();

/** Rebases `request`'s pull request onto its base and pushes it; refuses a `cwd` whose `origin` is another repository. */
export async function rebasePullRequest(request: PullRequestRebase): Promise<RebasedPullRequest> {
	const [, branches] = await Promise.all([assertWorkspaceOf(request.cwd, request), headOf(request)]);
	if (branches.fork) throw new Error(`Pull request #${request.number}'s branch is in a fork, which this dashboard does not push to.`);
	const key = await commonDir(request.cwd);
	const lane = lanes.get(key) ?? new SerialLane();
	lanes.set(key, lane);
	try {
		return await lane.run(() => rebaseBranch(request.cwd, branches, request.number));
	} finally {
		if (!lane.busy && lanes.get(key) === lane) lanes.delete(key);
	}
}
