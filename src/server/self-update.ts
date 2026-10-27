/**
 * **Update dashboard**: fast-forwards the checkout the server runs from to its branch on `origin`, installs the packages
 * when `bun.lock` changed, and has the server run again. It never stashes, resets, or merges: a checkout it cannot
 * fast-forward stays as it was, and the answer says why.
 */
import { run, runChecked } from "../proc";
import { SerialLane } from "../serial-lane";
import type { ChangelogEntry, DashboardChangelog, DashboardUpdateOutcome, DashboardUpdateStatus } from "../shared/dashboard-update";
import { packagedResources, sourceDir } from "./resources";

/** The checkout the server started from: its top directory, the branch it had checked out, and that branch's commit. */
export interface RunningBuild {
	dir: string;
	branch: string;
	commit: string;
}

/** The checkout the server runs from, or why it cannot update itself. */
export type Checkout = { kind: "checkout"; build: RunningBuild } | { kind: "unavailable"; reason: string };

const unavailable = (reason: string): Checkout => ({ kind: "unavailable", reason });

/** Why an update left the checkout as it was. */
export class UpdateRefused extends Error {}

/** Long enough for a fetch; any git call that takes longer is stuck. */
const GIT_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
/** Lets the answer that announced the restart reach the page or the agent that asked before the server stops. */
const RESTART_DELAY_MS = 300;

const originRef = (branch: string): string => `refs/remotes/origin/${branch}`;

/**
 * Runs git in `dir` and answers its exit code, one of `codes`, with its output. Any other code, a timeout's included,
 * is git failing rather than answering, so the update refuses with git's first `fatal:` or `error:` line: a failed
 * fetch ends its output with advice, not the cause.
 */
async function gitIn(dir: string, args: string[], codes: readonly number[] = [0]): Promise<{ code: number; stdout: string }> {
	const { code, stdout, stderr } = await run(["git", "-C", dir, ...args], { timeoutMs: GIT_TIMEOUT_MS });
	if (codes.includes(code)) return { code, stdout };
	const lines = stderr.split("\n").map(line => line.trim()).filter(Boolean);
	const cause = lines.find(line => line.startsWith("fatal:") || line.startsWith("error:")) ?? lines.at(-1) ?? `exit code ${code}`;
	throw new UpdateRefused(`git ${args[0]} failed in ${dir}: ${cause}`);
}

/** The commit `ref` names, or `null` when it names none (`rev-parse --verify --quiet` exits 1). */
async function commitOf(dir: string, ref: string): Promise<string | null> {
	const { code, stdout } = await gitIn(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], [0, 1]);
	return code === 0 ? stdout.trim() : null;
}

/** The branch `dir` has checked out, or `null` on a detached HEAD (`symbolic-ref --quiet` exits 1). */
async function branchOf(dir: string): Promise<string | null> {
	const { code, stdout } = await gitIn(dir, ["symbolic-ref", "--short", "--quiet", "HEAD"], [0, 1]);
	return code === 0 ? stdout.trim() : null;
}

/** The build checked out in `dir`, or why the server there cannot update itself. */
export async function readBuild(dir: string): Promise<Checkout> {
	try {
		const top = await gitIn(dir, ["rev-parse", "--show-toplevel"], [0, 128]);
		if (top.code !== 0) return unavailable("omp-agents does not run from a git checkout.");
		const checkout = top.stdout.trim();
		const branch = await branchOf(checkout);
		if (branch === null) return unavailable(`${checkout} has a detached HEAD, so it follows no branch.`);
		const commit = await commitOf(checkout, "HEAD");
		return commit === null ? unavailable(`${branch} has no commit yet.`) : { kind: "checkout", build: { dir: checkout, branch, commit } };
	} catch (err) {
		if (err instanceof UpdateRefused) return unavailable(err.message);
		throw err;
	}
}

/** Fetches `origin/<branch>`; `false`, without asking origin, when the branch was never fetched from there, as a branch never pushed. */
async function fetchBranch({ dir, branch }: RunningBuild): Promise<boolean> {
	if ((await commitOf(dir, originRef(branch))) === null) return false;
	await gitIn(dir, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:${originRef(branch)}`]);
	return true;
}

/** How many commits `origin/<branch>`, as last fetched, holds that `commit` lacks. */
async function commitsPast({ dir, branch, commit }: RunningBuild): Promise<number> {
	if ((await commitOf(dir, originRef(branch))) === null) return 0;
	return Number((await gitIn(dir, ["rev-list", "--count", `${commit}..${originRef(branch)}`])).stdout.trim());
}

/**
 * Fetches `origin/<branch>` and fast-forwards the checkout to it. Refuses, leaving the checkout as it was, when the
 * checkout moved to another branch, has changes to tracked files, has commits origin lacks, or git fails. Answers the
 * commit the checkout is at and whether its `bun.lock` differs from the running build's.
 */
export async function fastForward(build: RunningBuild): Promise<{ head: string; lockChanged: boolean }> {
	const { dir, branch, commit } = build;
	const now = await branchOf(dir);
	if (now !== branch) throw new UpdateRefused(`${dir} is on ${now ?? "a detached HEAD"} now, not ${branch}, which the server runs.`);
	const changed = (await gitIn(dir, ["status", "--porcelain", "--untracked-files=no"])).stdout.trimEnd();
	if (changed) {
		const files = changed.split("\n").map(line => line.slice(3));
		throw new UpdateRefused(`${dir} has changes to tracked files (${files.join(", ")}). Commit or discard them, then update.`);
	}
	if (!(await fetchBranch(build))) throw new UpdateRefused(`origin has no ${branch} branch to update from.`);
	const [head, remote] = await Promise.all([commitOf(dir, "HEAD"), commitOf(dir, originRef(branch))]);
	if (head === null || remote === null) throw new UpdateRefused(`${dir} lost its ${branch} branch.`);
	const lock = await gitIn(dir, ["diff", "--quiet", commit, remote, "--", "bun.lock"], [0, 1]);
	if (head !== remote) {
		const ancestor = await gitIn(dir, ["merge-base", "--is-ancestor", head, remote], [0, 1]);
		if (ancestor.code === 1) throw new UpdateRefused(`${branch} has commits origin/${branch} lacks, so it cannot fast-forward.`);
		await gitIn(dir, ["merge", "--ff-only", "--quiet", remote]);
	}
	return { head: remote, lockChanged: lock.code === 1 };
}

/** Installs the packages `bun.lock` names, as `bun install --frozen-lockfile` does. */
async function bunInstall(dir: string): Promise<void> {
	try {
		await runChecked([process.execPath, "install", "--frozen-lockfile"], { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS });
	} catch (err) {
		throw new Error(`bun install --frozen-lockfile failed, so omp-agents did not restart: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** The most feature commits What's new lists. */
const CHANGELOG_LIMIT = 300;
/** A feature subject: `feat:`, `feat(area):`, `feat!:`, or one that starts with `Add `. */
const FEATURE_GREP = "^(feat(\\([^)]*\\))?!?:|Add )";
const FEAT_PREFIX = /^feat(?:\(([^)]*)\))?!?:\s*/;
const PR_SUFFIX = /\s*\(#(\d+)\)$/;

/**
 * Reads `git log --format=%H%x1f%ct%x1f%s` lines into entries; `pending` holds the commits the running build lacks.
 * A subject that is not a feature, as a line `--grep` let through, is dropped.
 */
function parseChangelog(log: string, pending: ReadonlySet<string>): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	for (const line of log.split("\n")) {
		const [commit, seconds, subject] = line.split("\x1f");
		if (!commit || !seconds || subject === undefined) continue;
		const feat = FEAT_PREFIX.exec(subject);
		if (!feat && !subject.startsWith("Add ")) continue;
		let title = feat ? subject.slice(feat[0].length) : subject;
		const pr = PR_SUFFIX.exec(title);
		if (pr) title = title.slice(0, pr.index);
		if (!title) continue;
		entries.push({
			commit,
			at: Number(seconds) * 1000,
			title: title[0]!.toUpperCase() + title.slice(1),
			area: feat?.[1] || null,
			pr: pr ? Number(pr[1]) : null,
			installed: !pending.has(commit),
		});
	}
	return entries;
}

/** The feature commits on the running build and on `origin/<branch>` as last fetched, newest first. */
async function readChangelog({ dir, branch, commit }: RunningBuild): Promise<ChangelogEntry[]> {
	const remote = await commitOf(dir, originRef(branch));
	const heads = remote === null ? [commit] : [commit, remote];
	const pending = remote === null ? "" : (await gitIn(dir, ["rev-list", `${commit}..${remote}`])).stdout;
	const log = await gitIn(dir, ["log", "--no-merges", "-E", `--grep=${FEATURE_GREP}`, `--max-count=${CHANGELOG_LIMIT}`, "--format=%H%x1f%ct%x1f%s", ...heads]);
	return parseChangelog(log.stdout, new Set(pending.split("\n").filter(Boolean)));
}

/** The server's own update: the build it runs, or why it cannot update; one git call chain at a time; and the restart it ends with. */
export class SelfUpdate {
	readonly #checkout: Checkout;
	readonly #restart: () => void;
	readonly #install: (dir: string) => Promise<void>;
	/** The fetches, the counts, and the update, one at a time, so a check never fetches under a fast-forward. */
	readonly #lane = new SerialLane();
	/** The update that started the restart, which any later one answers too. */
	#restarting: DashboardUpdateOutcome | null = null;

	/** `restart` stops the server and runs it again on the checkout as it now is. */
	constructor(checkout: Checkout, restart: () => void, install: (dir: string) => Promise<void> = bunInstall) {
		this.#checkout = checkout;
		this.#restart = restart;
		this.#install = install;
	}

	/** The server's own: a packaged app updates through its own updater, and a checkout through this where the server can run itself again in place. */
	static async forServer(restart: () => void): Promise<SelfUpdate> {
		const checkout = packagedResources
			? unavailable("The packaged app updates itself: choose Check for Updates in its app menu.")
			: process.execve
				? await readBuild(sourceDir)
				: unavailable("This system cannot run the server again in place, so restart it by hand after a pull.");
		return new SelfUpdate(checkout, restart);
	}

	/** Where the server stands, as of the last fetch: this asks origin nothing. */
	status(): Promise<DashboardUpdateStatus> {
		return this.#lane.run(async () => {
			const checkout = this.#checkout;
			if (checkout.kind === "unavailable") return checkout;
			const { branch, commit } = checkout.build;
			return { kind: "checkout", branch, running: commit, behind: await commitsPast(checkout.build) };
		});
	}

	/**
	 * Fetches the branch and counts the commits past the running build; `null` when there are none, the server cannot
	 * update, or it restarts: a fetch then would outlive `execve` and hold `.git`'s lock against the new server's check.
	 */
	newCommits(): Promise<{ branch: string; running: string; commits: number } | null> {
		return this.#lane.run(async () => {
			const checkout = this.#checkout;
			if (this.#restarting || checkout.kind === "unavailable" || !(await fetchBranch(checkout.build))) return null;
			const commits = await commitsPast(checkout.build);
			return commits > 0 ? { branch: checkout.build.branch, running: checkout.build.commit, commits } : null;
		});
	}

	/** Settings › What's new: the feature commits the checkout holds, as of the last fetch; this asks origin nothing. */
	changelog(): Promise<DashboardChangelog> {
		return this.#lane.run(async () => {
			const checkout = this.#checkout;
			if (checkout.kind === "unavailable") return checkout;
			return { kind: "checkout", branch: checkout.build.branch, entries: await readChangelog(checkout.build) };
		});
	}

	/**
	 * Fast-forwards the checkout, installs the packages when `bun.lock` changed, and restarts the server shortly after
	 * answering, once the checkout holds another commit than the running one. Rejects with {@link UpdateRefused} when the
	 * checkout cannot fast-forward.
	 */
	update(): Promise<DashboardUpdateOutcome> {
		return this.#lane.run(async () => {
			if (this.#restarting) return this.#restarting;
			const checkout = this.#checkout;
			if (checkout.kind === "unavailable") throw new UpdateRefused(checkout.reason);
			const { build } = checkout;
			const { head, lockChanged } = await fastForward(build);
			if (head === build.commit) return { kind: "current" };
			if (lockChanged) await this.#install(build.dir);
			this.#restarting = { kind: "restarting", from: build.commit, to: head, installed: lockChanged };
			setTimeout(this.#restart, RESTART_DELAY_MS);
			return this.#restarting;
		});
	}
}
