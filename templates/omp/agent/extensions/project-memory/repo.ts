import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** A full commit id. */
export type Sha = string & { readonly __sha: unique symbol };

/** One repository, shared by its main checkout and every linked worktree. */
export interface Root {
	/** Absolute `git rev-parse --git-common-dir`. */
	commonDir: string;
	/** The main checkout's folder name, or the bare repository's. */
	name: string;
}

/** Where a session runs: its repository, its checkout's top, and the branch checked out there (`null` when detached). */
export interface Place {
	root: Root;
	top: string;
	branch: string | null;
}

/** The branch work lands on and its tip. */
export interface Target {
	name: string;
	tip: Sha;
}

/** One first-parent commit of the target, with the sessions whose commits it brought in. */
export interface Landing {
	sha: Sha;
	title: string;
	sessions: string[];
	files: string[];
}

export interface Intent {
	intent: string;
	/** ISO time the session recorded it. */
	at: string;
}

function run(dir: string, args: string[]) {
	return spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

function git(dir: string, args: string[]): string {
	const result = run(dir, args);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim() || result.error?.message}`);
	return result.stdout.trim();
}

/** git's stdout in `dir`, `null` when git exits 1, the "no" of `rev-parse --verify --quiet` and `symbolic-ref --quiet`. */
function probe(dir: string, args: string[]): string | null {
	const result = run(dir, args);
	if (result.status === 1) return null;
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim() || result.error?.message}`);
	return result.stdout.trim();
}

/** Whether `ancestor` is `descendant` or one of its ancestors; `false` also for a commit git no longer has. */
export const contains = (dir: string, descendant: Sha, ancestor: Sha): boolean => run(dir, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;

/** Where `cwd` sits in git, `null` outside a checkout. */
export function placeOf(cwd: string): Place | null {
	const found = run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
	if (found.status !== 0) return null;
	const [commonDir, top] = found.stdout.trim().split("\n");
	if (!commonDir || !top) return null;
	const name = basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir).replace(/\.git$/, "");
	return { root: { commonDir, name }, top, branch: probe(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]) };
}

/**
 * The branch `origin/HEAD` names, else `main`, else `master`, at whichever of its local and `origin/` tips contains the
 * other; the local tip when they diverged, since the user's own branch is what they last looked at.
 */
export function targetOf(dir: string): Target | null {
	const originHead = probe(dir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	for (const name of originHead ? [originHead.replace(/^origin\//, "")] : ["main", "master"]) {
		const local = probe(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`]) as Sha | null;
		const remote = probe(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}^{commit}`]) as Sha | null;
		if (local && remote) return { name, tip: local !== remote && contains(dir, remote, local) ? remote : local };
		if (local || remote) return { name, tip: (local ?? remote) as Sha };
	}
	return null;
}

function titleOf(subject: string): string {
	return /^Merge branch '([^']+)'/.exec(subject)?.[1] ?? /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)?.[1] ?? subject;
}

/**
 * The target's first-parent commits, newest first: those after `range.since`, or the newest `range.newest`. A merge's
 * sessions are the `Omp-Session` trailers of the commits it brought in, oldest first; another commit's are its own. A
 * landing whose own commit carries `except`'s trailer is left out, since that session landed it.
 */
export function landings(dir: string, target: Target, range: { since: Sha } | { newest: number }, except: string | null): Landing[] {
	const revs = "since" in range ? [`${range.since}..${target.tip}`] : ["-n", String(range.newest), target.tip];
	// `--first-parent` makes `--name-only` diff a merge against its first parent: the files the landing changed.
	const log = git(dir, ["log", "--first-parent", "--name-only", "--format=%x1e%H%x1f%P%x1f%s%x1f%(trailers:key=Omp-Session,valueonly,separator=%x2c)%x1f", ...revs]);
	const found: Landing[] = [];
	for (const record of log.split("\x1e").slice(1)) {
		const [sha, parents, subject, trailers, files] = record.split("\x1f");
		const own = (trailers ?? "").split(",").filter(Boolean);
		if (except && own.includes(except)) continue;
		const [first, second] = (parents ?? "").split(" ");
		const sessions = second
			? [...new Set(git(dir, ["log", "--reverse", "--format=%(trailers:key=Omp-Session,valueonly,separator=%x0a)", `${first}..${second}`]).split("\n").filter(Boolean))]
			: own;
		found.push({ sha: sha as Sha, title: titleOf(subject ?? ""), sessions, files: (files ?? "").split("\n").filter(Boolean) });
	}
	return found;
}

/** The files `place`'s branch changed since it left the target; none for a session on the target itself. */
export function ownFiles(place: Place, target: Target): Set<string> {
	if (place.branch === target.name) return new Set();
	const base = probe(place.top, ["merge-base", target.tip, "HEAD"]);
	return new Set(base ? git(place.top, ["diff", "--name-only", base, "HEAD"]).split("\n").filter(Boolean) : []);
}

const intentDir = (root: Root) => join(root.commonDir, "omp-project-memory", "intents");

/** Records `session`'s intent once: a retried first prompt finds the record there and keeps it. */
export function recordIntent(root: Root, session: string, intent: string, at: string): void {
	const dir = intentDir(root);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.${session}.${randomUUID()}.tmp`);
	writeFileSync(temp, `${JSON.stringify({ intent, at } satisfies Intent)}\n`);
	try {
		// A hard link never replaces an existing name, so the first record wins without a check-then-write race.
		linkSync(temp, join(dir, `${session}.json`));
	} catch (error) {
		if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
	} finally {
		rmSync(temp, { force: true });
	}
}

/** Every recorded intent by session id; a damaged record is skipped. */
export function readIntents(root: Root): Map<string, Intent> {
	const dir = intentDir(root);
	const intents = new Map<string, Intent>();
	if (!existsSync(dir)) return intents;
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		try {
			const record: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
			if (typeof record === "object" && record !== null && "intent" in record && "at" in record && typeof record.intent === "string" && typeof record.at === "string") {
				intents.set(name.slice(0, -".json".length), { intent: record.intent, at: record.at });
			}
		} catch {}
	}
	return intents;
}
