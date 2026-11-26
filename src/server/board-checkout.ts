/**
 * Where the sessions on a Board task work, and how the server lands their branch: one branch per Board task, checked
 * out in a linked worktree beside the repository, `<repository>-wt/<branch>`, that the runner adds before each round
 * and adds back after ending a session removed it. Both run the repository's own commands, so each waits for project
 * trust to admit the checkout first. See docs/architecture/board.md.
 */
import { existsSync } from "node:fs";
import { holderOf, mainCheckoutOf, restoreWorktree, worktreeAt } from "../git";
import { runShell } from "../proc";
import { configAt } from "../../templates/omp/agent/extensions/land/gate";
import { CONFIG_FILE, describe, land } from "../../templates/omp/agent/extensions/land/lander";

/** How long one of `.omp/land.json`'s setup commands, such as installing dependencies, may run in a new worktree. */
const SETUP_TIMEOUT_MS = 10 * 60_000;
const SETUP_OUTPUT = 4000;
/** How long adding or removing a worktree may take, installed dependencies included. */
const WORKTREE_TIMEOUT_MS = 2 * 60_000;

/** Lets project code run in a directory, or throws {@link UntrustedProjectError} when the user has not trusted it as it is now. */
export type Admit = (dir: string) => Promise<void>;

/** What a land for the user's "Merge on main" came to; see `ModuleRunCore.land`. */
export interface BoardLand {
	outcome: "landed" | "failed" | "refused";
	text: string;
}

/** The repository `workspace` belongs to, as git commands take it: its main checkout, else its git directory; `null` outside git. */
async function repositoryOf(workspace: string): Promise<string | null> {
	const at = await worktreeAt(workspace);
	return at && (mainCheckoutOf(at) ?? at.common);
}

const removeWorktree = (repository: string, dir: string): Promise<string> => runChecked(["git", "-C", repository, "worktree", "remove", "--force", "--", dir], { timeoutMs: WORKTREE_TIMEOUT_MS });

/**
 * The worktree of `workspace`'s repository that has `branch` checked out: the one that has it now, else one added at
 * `<repository>-wt/<branch>`, on the local branch while it exists, else on a new one from origin's or the default
 * branch, which `admit` must let run project code before `.omp/land.json`'s setup runs in it. A worktree whose admission
 * or setup failed is removed again, so the next round adds it and runs the setup anew. `null` when `workspace` is
 * outside git, where sessions work in it as it is.
 * @throws Error with git's, the trust check's, or the setup's reason when the worktree cannot be made ready.
 */
export async function boardCheckout(workspace: string, branch: string, admit: Admit): Promise<string | null> {
	const repository = await repositoryOf(workspace);
	if (!repository) return null;
	const held = await holderOf(repository, branch);
	if (held) return held.path;
	const dir = `${repository}-wt/${branch.replace(/[^\w.-]+/g, "-")}`;
	if (existsSync(dir)) throw new Error(`${dir} already exists, and it is no worktree on ${branch}.`);
	await restoreWorktree(repository, dir, branch);
	try {
		await admit(dir);
		for (const command of configAt(dir)?.setup ?? []) {
			const done = await runShell(command, dir, { timeoutMs: SETUP_TIMEOUT_MS, maxOutput: SETUP_OUTPUT });
			if (done.exitCode !== 0) throw new Error(`The setup \`${command}\` in ${dir} ${done.exitCode === null ? "was stopped" : `exited with code ${done.exitCode}`}: ${done.output}`);
		}
	} catch (error) {
		try {
			await removeWorktree(repository, dir);
		} catch (removing) {
			throw new Error(`${errorText(error)} Removing ${dir} again failed too: ${errorText(removing)}`);
		}
		throw error;
	}
	return dir;
}

/**
 * Lands `branch` of `workspace`'s repository as the land tool does, for the user's "Merge on main": from the worktree
 * that has it checked out, else from a detached checkout of its tip that it removes after, so it neither adds a
 * session's worktree nor runs its setup; the lander merges and checks in a worktree of its own.
 */
export async function landBoardBranch(workspace: string, branch: string, sessionId: string | undefined, admit: Admit): Promise<BoardLand> {
	const repository = await repositoryOf(workspace);
	if (!repository) return { outcome: "failed", text: `${workspace} is no longer in git.` };
	const held = await worktreeOnBranch(repository, branch);
	if (held) return landFrom(held.path, sessionId, admit);
	const dir = mkdtempSync(join(tmpdir(), "omp-board-land-"));
	rmSync(dir, { recursive: true });
	await runChecked(["git", "-C", repository, "worktree", "add", "--quiet", "--detach", dir, branch], { timeoutMs: WORKTREE_TIMEOUT_MS });
	try {
		return await landFrom(dir, sessionId, admit);
	} finally {
		await removeWorktree(repository, dir).catch((error: unknown) => console.error(`omp-agents: could not remove ${dir}: ${errorText(error)}`));
	}
}

/** Lands the branch checked out at `dir`, the top of a worktree, once `admit` lets its land config's setup and checks run. */
async function landFrom(dir: string, sessionId: string | undefined, admit: Admit): Promise<BoardLand> {
	if (!existsSync(join(dir, CONFIG_FILE))) return { outcome: "refused", text: `This repository has no ${CONFIG_FILE}, so the Board has no checks to land with. Push the branch and open a pull request instead.` };
	try {
		await admit(dir);
	} catch (error) {
		if (error instanceof UntrustedProjectError) return { outcome: "refused", text: error.message };
		throw error;
	}
	const result = await land({ cwd: dir, divergence: "None: the user asked for this merge on the Board.", ...(sessionId ? { sessionId } : {}) });
	return { outcome: result.kind === "landed" || result.kind === "nothing" ? "landed" : "failed", text: describe(result) };
}
