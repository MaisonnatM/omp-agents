/** The git checkout a directory is in, and the worktree a new session's branch runs in. */
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { repoOf } from "./github";
import { run, runChecked } from "./proc";
import { type BranchChoice, type GitCheckout, worktreeDir } from "./shared/git";

const HEADS = "refs/heads/";

export interface Registration {
	path: string;
	head: string;
	/** `null` when HEAD is detached. */
	branch: string | null;
	locked: string | null;
	prunable: string | null;
	main: boolean;
	bare: boolean;
}

export const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", "-C", cwd, ...args], { timeoutMs: 10000 });

export async function canonical(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		const parent = dirname(resolve(path));
		if (parent === resolve(path)) throw err;
		return join(await canonical(parent), basename(path));
	}
}

export async function commonDir(cwd: string): Promise<string> {
	return canonical((await git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
}

/** Git's NUL-separated porcelain format preserves paths and lock reasons containing newlines. Main checkout first. */
export function parseWorktrees(porcelain: string): Registration[] {
	return porcelain.split("\0\0").filter(Boolean).map((block, index) => {
		const fields = block.split("\0");
		const value = (name: string) => fields.find(field => field === name || field.startsWith(`${name} `))?.slice(name.length + 1) ?? null;
		const path = value("worktree");
		if (!path) throw new Error("Git returned an unreadable worktree registration.");
		return {
			path, head: value("HEAD") ?? "", branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
			locked: value("locked"), prunable: value("prunable"), main: index === 0, bare: fields.includes("bare"),
		};
	});
}

export const worktreesOf = async (cwd: string): Promise<Registration[]> => parseWorktrees(await git(cwd, "worktree", "list", "--porcelain", "-z"));

/** Local branch names, the most recently committed to first. */
const branchesOf = async (cwd: string): Promise<string[]> =>
	(await runChecked(["git", "-C", cwd, "for-each-ref", "--sort=-committerdate", "--format=%(refname)", HEADS]))
		.split("\n")
		.filter(ref => ref.startsWith(HEADS))
		.map(ref => ref.slice(HEADS.length));

/** The worktree a directory is in, and the repository that worktree belongs to, as absolute paths. */
export interface WorktreeAt {
	/** The worktree's root directory. */
	top: string;
	/** The git directory every worktree of the repository shares. */
	common: string;
}

/** The worktree `dir` is in, `null` when it is in none. */
export async function worktreeAt(dir: string): Promise<WorktreeAt | null> {
	const { code, stdout } = await run(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
	const [top, common] = stdout.trim().split("\n");
	return code === 0 && top && common ? { top, common } : null;
}

/** The checkout `cwd` is in, `null` when it is in none. */
export async function gitCheckout(cwd: string): Promise<GitCheckout | null> {
	const inside = await run(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"]);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") return null;
	const [worktrees, names, head, github] = await Promise.all([
		worktreesOf(cwd).then(rows => rows.filter(row => row.prunable === null)),
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
		worktreesOf(cwd).then(rows => rows.filter(row => row.prunable === null)),
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
