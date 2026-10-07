/** The git checkout a directory is in, and the worktree a new session's branch runs in. */
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { run, runChecked } from "./proc";
import { type BranchChoice, type GitCheckout, type GitStatus, type StatusKind, worktreeDir } from "./shared/git";

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
	const [worktrees, names, head] = await Promise.all([
		worktreesOf(cwd).then(rows => rows.filter(row => row.prunable === null)),
		branchesOf(cwd),
		run(["git", "-C", cwd, "symbolic-ref", "--quiet", "HEAD"]),
	]);
	const ref = head.stdout.trim();
	const branch = head.code === 0 && ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null;
	const worktreeOf = new Map(worktrees.flatMap(worktree => (worktree.branch ? [[worktree.branch, worktree.path] as const] : [])));
	const ordered = branch === null ? names : [branch, ...names.filter(name => name !== branch)];
	return {
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

/** The kind of a `1` record's first status letter that is not `.`: the index's, else the worktree's. */
const ORDINARY: Record<string, StatusKind> = { M: "modified", T: "modified", A: "added", D: "deleted" };

/** What follows the first `fields` space-separated fields of a record: its path, which may hold spaces. */
function pathAfter(record: string, fields: number): string {
	let index = 0;
	for (let field = 0; field < fields; field++) index = record.indexOf(" ", index) + 1;
	return record.slice(index);
}

/** `git status --porcelain=v2 --branch -z` of the checkout at `root`. */
export function parseStatus(root: string, porcelain: string): GitStatus {
	const records = porcelain.split("\0");
	let branch: string | null = null;
	let upstream: string | null = null;
	let counts: { ahead: number; behind: number } | null = null;
	const files: GitStatus["files"] = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index]!;
		if (record.startsWith("# branch.head ")) {
			const head = record.slice("# branch.head ".length);
			branch = head === "(detached)" ? null : head;
		} else if (record.startsWith("# branch.upstream ")) upstream = record.slice("# branch.upstream ".length);
		else if (record.startsWith("# branch.ab ")) {
			const [ahead = "", behind = ""] = record.slice("# branch.ab ".length).split(" ");
			counts = { ahead: Math.abs(Number(ahead)), behind: Math.abs(Number(behind)) };
		} else if (record.startsWith("1 ")) {
			const [x = ".", y = "."] = record.slice(2, 4);
			files.push({ path: pathAfter(record, 8), kind: ORDINARY[x === "." ? y : x] ?? "modified" });
		} else if (record.startsWith("2 ")) {
			files.push({ path: pathAfter(record, 9), kind: record[2] === "C" ? "added" : "renamed" });
			// The path it was renamed or copied from follows as a record of its own.
			index++;
		} else if (record.startsWith("u ")) files.push({ path: pathAfter(record, 10), kind: "conflicted" });
		else if (record.startsWith("? ")) files.push({ path: record.slice(2), kind: "untracked" });
	}
	// git names an upstream whose ref is gone but counts nothing against it.
	return { root, branch, upstream: upstream !== null && counts ? { name: upstream, ...counts } : null, files };
}

/** The branch and uncommitted files of the checkout `dir` is in, `null` outside one. */
export async function gitStatus(dir: string): Promise<GitStatus | null> {
	const at = await worktreeAt(dir);
	return at && parseStatus(at.top, await git(at.top, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"));
}

/**
 * Switches the checkout `dir` is in to an existing branch, or to a new one from `base`, carrying its uncommitted changes
 * as `git switch` does.
 * @throws Error with git's reason, as when another worktree has the branch checked out or a change would be overwritten.
 */
export async function switchBranch(dir: string, choice: BranchChoice): Promise<void> {
	const names = await branchesOf(dir);
	const from = choice.kind === "existing" ? choice.name : choice.base;
	if (!names.includes(from)) throw new Error(`No local branch is named ${from}.`);
	if (choice.kind === "existing") {
		await git(dir, "switch", "--no-guess", choice.name);
		return;
	}
	if (names.includes(choice.name)) throw new Error(`A branch named ${choice.name} already exists.`);
	await git(dir, "check-ref-format", "--branch", choice.name);
	await git(dir, "switch", "--no-guess", "-c", choice.name, choice.base);
}
