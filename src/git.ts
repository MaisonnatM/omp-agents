/** The git checkout a directory is in, and the worktree a new session's branch runs in. */
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

/** The git directory every worktree of `dir`'s repository shares, `null` when `dir` is gone or outside git. */
export async function repositoryAt(dir: string): Promise<string | null> {
	const { code, stdout } = await run(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
	return code === 0 ? canonical(stdout.trim()) : null;
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

/** The worktree of `cwd`'s repository that has `branch` checked out, `null` when none does. */
export async function holderOf(cwd: string, branch: string): Promise<Registration | null> {
	return (await worktreesOf(cwd)).find(worktree => worktree.prunable === null && worktree.branch === branch) ?? null;
}

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
	/** The worktree's own git directory, `common` in the main checkout. */
	gitDir: string;
	/** Whether it is a linked worktree rather than the repository's main checkout. */
	linked: boolean;
	/** The branch it has checked out, `null` when HEAD is detached. */
	branch: string | null;
}

/** The worktree `dir` is in, `null` when it is in none. */
export async function worktreeAt(dir: string): Promise<WorktreeAt | null> {
	const [{ code, stdout }, head] = await Promise.all([
		run(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-dir"]),
		run(["git", "-C", dir, "symbolic-ref", "--quiet", "HEAD"]),
	]);
	const [top, common, gitDir] = stdout.trim().split("\n");
	if (code !== 0 || !top || !common || !gitDir) return null;
	const ref = head.stdout.trim();
	return { top, common, gitDir, linked: gitDir !== common, branch: head.code === 0 && ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null };
}

/** The main checkout of `at`'s repository, which holds the `.git` that is `common`; `null` for a bare repository, which has none. */
export const mainCheckoutOf = (at: WorktreeAt): string | null => (basename(at.common) === ".git" ? dirname(at.common) : null);

/** What a worktree has checked out now, and the checkouts its HEAD reflog records, newest first. */
export interface HeadHistory {
	/** `null` when HEAD is detached. */
	branch: string | null;
	/** When each checkout ran, in ms, and the branch or commit it moved from. */
	moves: { at: number; from: string }[];
}

/** `HEAD@{1791534798}\tcheckout: moving from me/a to main`, as `--date=unix` names an entry. */
const CHECKOUT_ENTRY = /^HEAD@\{(\d+)\}\tcheckout: moving from (\S+) to \S+$/;
const COMMIT_ID = /^[0-9a-f]{40,64}$/;

/** The branch and the HEAD reflog's checkouts of the worktree `dir` is in, `null` when it is in none. */
export async function headHistory(dir: string): Promise<HeadHistory | null> {
	const [log, head] = await Promise.all([
		run(["git", "-C", dir, "reflog", "show", "--date=unix", "--format=%gd%x09%gs", "HEAD"]),
		run(["git", "-C", dir, "symbolic-ref", "--quiet", "HEAD"]),
	]);
	if (log.code !== 0) return null;
	const moves = log.stdout.split("\n").flatMap(line => {
		const entry = CHECKOUT_ENTRY.exec(line);
		return entry ? [{ at: Number(entry[1]) * 1000, from: entry[2]! }] : [];
	});
	const ref = head.stdout.trim();
	return { branch: head.code === 0 && ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null, moves };
}

/** The branch checked out at `at`: the one the first checkout after it moved from, else the one checked out now; `null` on a detached HEAD. */
export function branchAt(history: HeadHistory, at: number): string | null {
	let branch = history.branch;
	for (const move of history.moves) {
		if (move.at <= at) break;
		branch = COMMIT_ID.test(move.from) ? null : move.from;
	}
	return branch;
}

/** The branch `origin/HEAD` names in `dir`'s repository, its default branch; `null` outside git or when git has not recorded one. */
export async function defaultBranchOf(dir: string): Promise<string | null> {
	const { code, stdout } = await run(["git", "-C", dir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	const ref = stdout.trim();
	return code === 0 && ref.startsWith("origin/") ? ref.slice("origin/".length) : null;
}

/** What git says of the checkouts directories are in, as `worktreeAt`, `headHistory`, and `defaultBranchOf` answer. */
export interface CheckoutReads {
	worktreeAt(dir: string): Promise<WorktreeAt | null>;
	headHistory(dir: string): Promise<HeadHistory | null>;
	defaultBranchOf(dir: string): Promise<string | null>;
}

/** The reftable backend keeps every ref, HEAD and the reflog included, in the tables this file lists. */
const REFTABLE = join("reftable", "tables.list");

/** Each file's path, inode, modification time, and size, `-` for one that is missing: git replaces a ref file whole and appends to a reflog. */
async function stampOf(paths: readonly string[]): Promise<string> {
	const stamps = await Promise.all(paths.map(path => stat(path, { bigint: true }).then(s => `${path}=${s.ino}:${s.mtimeNs}:${s.size}`, () => `${path}=-`)));
	return stamps.join("\n");
}

interface Kept<T> {
	/** `stampOf` of the files git read, taken before it answered; `null` when none was, so the next ask asks git again. */
	stamp: string | null;
	answer: T;
}

const headFiles = (at: WorktreeAt): string[] => [join(at.gitDir, "HEAD"), join(at.gitDir, REFTABLE)];

/**
 * `CheckoutReads` for directories asked about again and again: each answer is reused while the files git read for it
 * are unchanged, so a refresh costs a few `stat`s and no `git` process until a checkout, a commit, or a `remote set-head`.
 * A directory outside git is asked again every time, since no file tells when it joins a repository.
 */
export class CachedCheckouts implements CheckoutReads {
	readonly #worktrees = new Map<string, Kept<WorktreeAt>>();
	readonly #histories = new Map<string, Kept<HeadHistory | null>>();
	readonly #defaults = new Map<string, Kept<string | null>>();

	worktreeAt = async (dir: string): Promise<WorktreeAt | null> => {
		const kept = this.#worktrees.get(dir);
		const stamp = kept ? await stampOf(headFiles(kept.answer)) : null;
		if (kept && stamp === kept.stamp) return kept.answer;
		const at = await worktreeAt(dir);
		if (at) this.#worktrees.set(dir, { stamp, answer: at });
		else this.#worktrees.delete(dir);
		return at;
	};

	headHistory = (dir: string): Promise<HeadHistory | null> =>
		this.#follow(this.#histories, dir, at => [...headFiles(at), join(at.gitDir, "logs", "HEAD")], headHistory);

	defaultBranchOf = (dir: string): Promise<string | null> =>
		this.#follow(this.#defaults, dir, at => [join(at.common, "refs", "remotes", "origin", "HEAD"), join(at.common, REFTABLE)], defaultBranchOf);

	/** `ask(dir)`, reused while the files `filesOf` names in `dir`'s checkout are unchanged; `null` outside git. */
	async #follow<T>(kept: Map<string, Kept<T | null>>, dir: string, filesOf: (at: WorktreeAt) => string[], ask: (dir: string) => Promise<T | null>): Promise<T | null> {
		const at = this.#worktrees.get(dir)?.answer ?? (await this.worktreeAt(dir));
		if (!at) {
			kept.delete(dir);
			return null;
		}
		const stamp = await stampOf(filesOf(at));
		const entry = kept.get(dir);
		if (entry?.stamp === stamp) return entry.answer;
		const answer = await ask(dir);
		kept.set(dir, { stamp, answer });
		return answer;
	}
}

/** The checkout `cwd` is in, `null` when it is in none. */
export async function gitCheckout(cwd: string): Promise<GitCheckout | null> {
	const at = await worktreeAt(cwd);
	if (!at) return null;
	const [worktrees, names] = await Promise.all([
		worktreesOf(cwd).then(rows => rows.filter(row => row.prunable === null)),
		branchesOf(cwd),
	]);
	const { branch } = at;
	const worktreeOf = new Map(worktrees.flatMap(worktree => (worktree.branch ? [[worktree.branch, worktree.path] as const] : [])));
	const ordered = branch === null ? names : [branch, ...names.filter(name => name !== branch)];
	return {
		branch,
		branches: ordered.map(name => ({ name, worktree: worktreeOf.get(name) ?? null })),
		mainWorktree: worktrees[0]?.path ?? cwd,
	};
}

/** How long a start waits on `git fetch` for the branch a pull request or ticket names. */
const FETCH_MS = 30_000;

/**
 * Where branch `name` of `cwd`'s repository comes from when no local branch has it: origin's branch, fetched, when
 * origin has it; else origin's default branch, fetched, for a new branch; else the main worktree's branch when the
 * repository has no origin.
 * @throws Error with git's reason when origin cannot be reached, so a pull request's branch never restarts from the default branch.
 */
async function workSource(cwd: string, name: string, mainBranch: string | null): Promise<{ track: boolean; ref: string }> {
	const opts = { timeoutMs: FETCH_MS, env: { GIT_TERMINAL_PROMPT: "0" } };
	if ((await run(["git", "-C", cwd, "remote", "get-url", "origin"])).code !== 0) {
		if (!mainBranch) throw new Error("The repository has no origin, and its main worktree has no branch checked out.");
		return { track: false, ref: mainBranch };
	}
	const listed = await run(["git", "-C", cwd, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${name}`], opts);
	// `--exit-code` exits 2 when origin answers without the branch.
	if (listed.code !== 0 && listed.code !== 2) throw new Error(`Cannot reach origin: ${listed.stderr.trim() || `git ls-remote exited ${listed.code}`}`);
	const base = listed.code === 0 ? name : (await runChecked(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "origin/HEAD"])).trim().replace(/^origin\//, "");
	await runChecked(["git", "-C", cwd, "fetch", "--quiet", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`], opts);
	return { track: listed.code === 0, ref: `origin/${base}` };
}

/**
 * The directory a new session started from `cwd` runs in on `choice`. An existing branch runs in the worktree that has
 * it checked out, `cwd` itself when that is `cwd`'s own worktree, else in a new worktree; a new branch always gets a
 * new worktree. A work branch is an existing one when a local branch has that name, else a new worktree on it, from
 * origin's branch or else from the default branch.
 * @throws Error with git's reason when the branch is unknown, the name is invalid, or the worktree cannot be added.
 */
export async function checkoutDir(cwd: string, choice: BranchChoice): Promise<string> {
	const [worktrees, names, own] = await Promise.all([
		worktreesOf(cwd).then(rows => rows.filter(row => row.prunable === null)),
		branchesOf(cwd),
		runChecked(["git", "-C", cwd, "rev-parse", "--show-toplevel"]),
	]);
	const existing = choice.kind === "existing" || (choice.kind === "work" && names.includes(choice.name));
	if (choice.kind === "new" && !names.includes(choice.base)) throw new Error(`No local branch is named ${choice.base}.`);
	if (choice.kind === "existing" && !names.includes(choice.name)) throw new Error(`No local branch is named ${choice.name}.`);
	if (existing) {
		const path = worktrees.find(worktree => worktree.branch === choice.name)?.path;
		if (path) return path === own.trim() ? cwd : path;
	} else {
		if (names.includes(choice.name)) throw new Error(`A branch named ${choice.name} already exists.`);
		await runChecked(["git", "-C", cwd, "check-ref-format", "--branch", choice.name]);
	}
	const main = worktrees[0];
	if (!main) throw new Error("git lists no worktree for this repository.");
	const dir = worktreeDir(main.path, choice.name);
	// `worktree add -b` creates the branch before it checks the path, so a taken path would leave the branch behind.
	if (existsSync(dir)) throw new Error(`${dir} already exists.`);
	if (existing) {
		await runChecked(["git", "-C", cwd, "worktree", "add", "--", dir, choice.name]);
	} else if (choice.kind === "new") {
		await runChecked(["git", "-C", cwd, "worktree", "add", "-b", choice.name, "--", dir, choice.base]);
	} else {
		const source = await workSource(cwd, choice.name, main.branch);
		await runChecked(["git", "-C", cwd, "worktree", "add", source.track ? "--track" : "--no-track", "-b", choice.name, "--", dir, source.ref]);
	}
	return dir;
}
