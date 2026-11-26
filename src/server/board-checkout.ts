/**
 * Where the sessions on a Board task work, and how the server lands their branch: one branch per Board task, checked
 * out in a linked worktree beside the repository, `<repository>-wt/<branch>`, that the runner adds before each round
 * and adds back after ending a session removed it. See docs/architecture/board.md.
 */
import { existsSync } from "node:fs";
import { holderOf, mainCheckoutOf, restoreWorktree, worktreeAt } from "../git";
import { runShell } from "../proc";
import { configAt } from "../../templates/omp/agent/extensions/land/gate";
import { describe, land } from "../../templates/omp/agent/extensions/land/lander";

/** How long one of `.omp/land.json`'s setup commands, such as installing dependencies, may run in a new worktree. */
const SETUP_TIMEOUT_MS = 10 * 60_000;
const SETUP_OUTPUT = 4000;

/**
 * The worktree of `workspace`'s repository that has `branch` checked out: the one that has it now, else one added at
 * `<repository>-wt/<branch>`, on the local branch while it exists, else on a new one from origin's or the default
 * branch, with `.omp/land.json`'s setup run in it. `null` when `workspace` is outside git, where sessions work in it as it is.
 * @throws Error with git's or the setup's reason when the worktree cannot be made ready.
 */
export async function boardCheckout(workspace: string, branch: string): Promise<string | null> {
	const at = await worktreeAt(workspace);
	if (!at) return null;
	const repository = mainCheckoutOf(at) ?? at.common;
	const held = await holderOf(repository, branch);
	if (held) return held.path;
	const dir = `${repository}-wt/${branch.replace(/[^\w.-]+/g, "-")}`;
	if (existsSync(dir)) throw new Error(`${dir} already exists, and it is no worktree on ${branch}.`);
	await restoreWorktree(repository, dir, branch);
	for (const command of configAt(dir)?.setup ?? []) {
		const done = await runShell(command, dir, { timeoutMs: SETUP_TIMEOUT_MS, maxOutput: SETUP_OUTPUT });
		if (done.exitCode !== 0) throw new Error(`The setup \`${command}\` in ${dir} ${done.exitCode === null ? "was stopped" : `exited with code ${done.exitCode}`}: ${done.output}`);
	}
	return dir;
}

/** Lands the branch checked out at `dir` as the land tool does, for the user's "Merge on main"; `text` is the result in words. */
export async function landBoardBranch(dir: string, sessionId: string | undefined): Promise<{ landed: boolean; text: string }> {
	const result = await land({ cwd: dir, divergence: "None: the user asked for this merge on the Board.", ...(sessionId ? { sessionId } : {}) });
	return { landed: result.kind === "landed", text: describe(result) };
}
