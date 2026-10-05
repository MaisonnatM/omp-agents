/** The git checkout a directory is in, and the worktree a new session's branch runs in. */
import { existsSync } from "node:fs";
import { repoOf } from "./github";
import { run, runChecked } from "./proc";
import { type BranchChoice, type GitCheckout, worktreeDir } from "./shared";

const HEADS = "refs/heads/";

interface Worktree {
	path: string;
	/** `null` when HEAD is detached. */
	branch: string | null;
}

/** `git worktree list --porcelain`, the main worktree first. Worktrees whose directory is gone are left out. */
export function parseWorktrees(porcelain: string): Worktree[] {
	return porcelain
		.split("\n\n")
		.map(block => block.split("\n"))
		.filter(lines => lines[0]?.startsWith("worktree ") && !lines.some(line => line.startsWith("prunable")))
		.map(lines => {
			const branch = lines.find(line => line.startsWith(`branch ${HEADS}`));
			return { path: lines[0]!.slice("worktree ".length), branch: branch ? branch.slice(`branch ${HEADS}`.length) : null };
		});
}

const worktreesOf = async (cwd: string): Promise<Worktree[]> => parseWorktrees(await runChecked(["git", "-C", cwd, "worktree", "list", "--porcelain"]));

/** Local branch names, the most recently committed to first. */
const branchesOf = async (cwd: string): Promise<string[]> =>
	(await runChecked(["git", "-C", cwd, "for-each-ref", "--sort=-committerdate", "--format=%(refname)", HEADS]))
		.split("\n")
		.filter(ref => ref.startsWith(HEADS))
		.map(ref => ref.slice(HEADS.length));

/** The checkout `cwd` is in, `null` when it is in none. */
export async function gitCheckout(cwd: string): Promise<GitCheckout | null> {
	const inside = await run(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"]);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") return null;
	const [worktrees, names, head, github] = await Promise.all([
		worktreesOf(cwd),
		branchesOf(cwd),
		run(["git", "-C", cwd, "symbolic-ref", "--quiet", "HEAD"]),
		repoOf(cwd),
	]);
	const ref = head.stdout.trim();
	const branch = head.code === 0 && ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null;
	const worktreeOf = new Map(worktrees.flatMap(worktree => (worktree.branch ? [[worktree.branch, worktree.path] as const] : [])));
	const ordered = branch === null ? names : [branch, ...names.filter(name => name !== branch)];
	return {
		github,
		branch,
		branches: ordered.map(name => ({ name, worktree: worktreeOf.get(name) ?? null })),
		mainWorktree: worktrees[0]?.path ?? cwd,
	};
}

/**
 * The directory a new session started from `cwd` runs in on `choice`. An existing branch runs in the worktree that has
 * it checked out, `cwd` itself when that is `cwd`'s own worktree, else in a new worktree; a new branch always gets a
 * new worktree.
 * @throws Error with git's reason when the branch is unknown, the name is invalid, or the worktree cannot be added.
 */
export async function checkoutDir(cwd: string, choice: BranchChoice): Promise<string> {
	const [worktrees, names, own] = await Promise.all([
		worktreesOf(cwd),
		branchesOf(cwd),
		runChecked(["git", "-C", cwd, "rev-parse", "--show-toplevel"]),
	]);
	const from = choice.kind === "existing" ? choice.name : choice.base;
	if (!names.includes(from)) throw new Error(`No local branch is named ${from}.`);
	if (choice.kind === "existing") {
		const path = worktrees.find(worktree => worktree.branch === choice.name)?.path;
		if (path) return path === own.trim() ? cwd : path;
	} else {
		if (names.includes(choice.name)) throw new Error(`A branch named ${choice.name} already exists.`);
		await runChecked(["git", "-C", cwd, "check-ref-format", "--branch", choice.name]);
	}
	const main = worktrees[0]?.path;
	if (!main) throw new Error("git lists no worktree for this repository.");
	const dir = worktreeDir(main, choice.name);
	// `worktree add -b` creates the branch before it checks the path, so a taken path would leave the branch behind.
	if (existsSync(dir)) throw new Error(`${dir} already exists.`);
	await runChecked(
		choice.kind === "new"
			? ["git", "-C", cwd, "worktree", "add", "-b", choice.name, "--", dir, choice.base]
			: ["git", "-C", cwd, "worktree", "add", "--", dir, choice.name],
	);
	return dir;
}
