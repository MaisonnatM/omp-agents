// Lands a committed branch on a repository's target branch, the way Ultimate's lander does, with no model in the loop:
// merge the branch tip into a fresh detached worktree of `<remote>/<target>`, run the checks `.omp/land.json` lists on
// the merged result, and push that merge commit, never forced. A push that loses a race to another landing starts
// again from the new tip. Each landing owns its worktree, so concurrent landings share nothing but the remote.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const CONFIG_FILE = ".omp/land.json";

/** One check, or a group whose checks run at the same time. */
export type CheckEntry = string | string[];

export interface LandConfig {
	target: string;
	remote: string;
	/** Commands run in the fresh worktree before the merge, such as installing dependencies. */
	setup: string[];
	checks: CheckEntry[];
}

export type LandResult =
	| { kind: "landed"; sha: string; base: string; flaky: string[]; local: string }
	| { kind: "nothing"; target: string }
	| { kind: "refused"; reason: string }
	| { kind: "conflict"; paths: string[] }
	| { kind: "failed"; command: string; why: string; failures: string[]; tail: string }
	| { kind: "rejected"; why: string };

export interface LandOptions {
	cwd: string;
	divergence: string;
	/** Reaches the merge commit as an `Omp-Session` trailer through the session-trailer hook, as the bash tool's commits do. */
	sessionId?: string;
	signal?: AbortSignal;
	progress?: (step: string) => void;
	/** Stops a check after this long without output; defaults to {@link SILENCE_MS}. */
	silenceMs?: number;
	/** Stops a check after this long in all; defaults to {@link TOTAL_MS}. */
	totalMs?: number;
}

const SILENCE_MS = 2 * 60_000;
const TOTAL_MS = 10 * 60_000;
const ATTEMPTS = 3;
const TAIL_CHARS = 4000;
const WORKTREE_PREFIX = "omp-land-";
/** Lines that name a failed test or a type error in the output of bun, Jest, Vitest, Go, TAP runners, and tsc. */
const FAILURE_LINE = /^\s*(\(fail\) |FAIL |--- FAIL: |not ok \d|✗ |× )|error TS\d+:/;
const MAX_FAILURES = 20;
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

interface Run {
	code: number | null;
	out: string;
	/** The output's {@link FAILURE_LINE} lines, from all of it, since a long run's failures scroll out of the tail. */
	failures: string[];
	stopped?: string;
}

/** Runs `file args` in its own process group, keeping the output's tail; `limits` stops it, and the whole group, when it falls silent or runs too long. */
function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, limits?: { silenceMs: number; totalMs: number }, signal?: AbortSignal): Promise<Run> {
	return new Promise(done => {
		const child = spawn(file, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let line = "";
		const failures: string[] = [];
		const scan = (text: string) => {
			const clean = text.replace(ANSI, "").trimEnd();
			if (failures.length < MAX_FAILURES && FAILURE_LINE.test(clean)) failures.push(clean.trim());
		};
		let stopped: string | undefined;
		const stop = (why: string) => {
			stopped ??= why;
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				// The group already exited between the timer firing and the kill.
			}
		};
		let silence: ReturnType<typeof setTimeout> | undefined;
		const quiet = () => {
			if (!limits) return;
			clearTimeout(silence);
			silence = setTimeout(() => stop(`no output for ${limits.silenceMs / 1000} s`), limits.silenceMs);
		};
		const total = limits ? setTimeout(() => stop(`still running after ${limits.totalMs / 1000} s`), limits.totalMs) : undefined;
		const onAbort = () => stop("the landing was cancelled");
		signal?.addEventListener("abort", onAbort, { once: true });
		const take = (chunk: Buffer) => {
			const text = chunk.toString();
			out = (out + text).slice(-TAIL_CHARS * 4);
			const lines = (line + text).split("\n");
			line = lines.pop()!;
			for (const complete of lines) scan(complete);
			quiet();
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		quiet();
		child.on("error", error => {
			out += String(error);
		});
		child.on("close", code => {
			clearTimeout(silence);
			clearTimeout(total);
			signal?.removeEventListener("abort", onAbort);
			scan(line);
			done({ code, out, failures, stopped });
		});
	});
}

/** The last lines of `out`, without terminal colors. */
export function tail(out: string): string {
	return out.replace(ANSI, "").trimEnd().slice(-TAIL_CHARS);
}

async function git(dir: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Run> {
	return run("git", args, dir, env);
}

async function gitOut(dir: string, args: string[]): Promise<string | null> {
	const r = await git(dir, args);
	return r.code === 0 ? r.out.trim() : null;
}

/** `.omp/land.json` of the checkout at `top`, `null` when it has none; throws on a file that is not a config. */
export function readConfig(top: string): LandConfig | null {
	const path = join(top, CONFIG_FILE);
	if (!existsSync(path)) return null;
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === "string" && s.length > 0);
	if (typeof raw !== "object" || raw === null) throw new Error(`${CONFIG_FILE} must hold an object`);
	const { target = "main", remote = "origin", setup = [], checks } = raw as Record<string, unknown>;
	if (typeof target !== "string" || !target) throw new Error(`${CONFIG_FILE}: target must be a branch name`);
	if (typeof remote !== "string" || !remote) throw new Error(`${CONFIG_FILE}: remote must be a remote name`);
	if (!isStrings(setup)) throw new Error(`${CONFIG_FILE}: setup must be a list of commands`);
	if (!Array.isArray(checks) || checks.length === 0 || !checks.every(c => (typeof c === "string" && c.length > 0) || (isStrings(c) && c.length > 0))) {
		throw new Error(`${CONFIG_FILE}: checks must list at least one command, or a list of commands that run at the same time`);
	}
	return { target, remote, setup, checks };
}

/** Whether a process with this pid still runs. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Removes the landing worktrees of `top` whose omp process has ended, as a crash or a kill leaves them. */
async function sweep(top: string): Promise<void> {
	const listing = (await gitOut(top, ["worktree", "list", "--porcelain"])) ?? "";
	for (const line of listing.split("\n")) {
		const path = line.startsWith("worktree ") ? line.slice(9) : null;
		const pid = path && basename(path).match(new RegExp(`^${WORKTREE_PREFIX}(\\d+)-`))?.[1];
		if (path && pid && !alive(Number(pid))) await git(top, ["worktree", "remove", "--force", path]);
	}
	await git(top, ["worktree", "prune"]);
}

/** Brings the local `target` branch up to `sha` when that only moves it forward and its checkout, if any, has no uncommitted changes; says what it did. */
async function syncLocal(top: string, target: string, sha: string): Promise<string> {
	const local = await gitOut(top, ["rev-parse", "-q", "--verify", `refs/heads/${target}`]);
	if (local === null) return `There is no local ${target} to update.`;
	if ((await git(top, ["merge-base", "--is-ancestor", local, sha])).code !== 0) return `Local ${target} has commits that are not on the remote, so it was left as it is.`;
	const listing = (await gitOut(top, ["worktree", "list", "--porcelain"])) ?? "";
	const checkout = listing.split("\n\n").find(block => block.split("\n").includes(`branch refs/heads/${target}`))?.match(/^worktree (.+)$/m)?.[1];
	if (!checkout) {
		const moved = await git(top, ["update-ref", `refs/heads/${target}`, sha, local]);
		return moved.code === 0 ? `Local ${target} now points at the landed commit.` : `Local ${target} could not be updated: ${tail(moved.out)}`;
	}
	if ((await gitOut(checkout, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
		return `Local ${target} in ${checkout} has uncommitted changes, so it stays behind; run git pull there when they are done.`;
	}
	const merged = await git(checkout, ["merge", "--ff-only", "--quiet", sha]);
	return merged.code === 0 ? `Local ${target} in ${checkout} fast-forwarded to the landed commit.` : `Local ${target} in ${checkout} stays behind: ${tail(merged.out)}`;
}

/** Runs one check, and once more when it fails; a pass on the second run is flaky. */
async function check(command: string, dir: string, env: NodeJS.ProcessEnv, limits: { silenceMs: number; totalMs: number }, options: LandOptions) {
	options.progress?.(`Running ${command}`);
	const first = await run("sh", ["-c", command], dir, env, limits, options.signal);
	if (first.code === 0 && !first.stopped) return { command, outcome: "passed" as const };
	if (options.signal?.aborted) return { command, outcome: "failed" as const, why: "the landing was cancelled", failures: first.failures, tail: tail(first.out) };
	options.progress?.(`Running ${command} again after it failed`);
	const second = await run("sh", ["-c", command], dir, env, limits, options.signal);
	if (second.code === 0 && !second.stopped) return { command, outcome: "flaky" as const };
	const why = second.stopped ? `it was stopped: ${second.stopped}` : `it exited with code ${second.code} twice`;
	return { command, outcome: "failed" as const, why, failures: second.failures, tail: tail(second.out) };
}

/** Lands the branch checked out at `options.cwd`; see the file comment. */
export async function land(options: LandOptions): Promise<LandResult> {
	const top = await gitOut(options.cwd, ["rev-parse", "--show-toplevel"]);
	if (top === null) return { kind: "refused", reason: `${options.cwd} is not in a git repository.` };
	let config: LandConfig | null;
	try {
		config = readConfig(top);
	} catch (error) {
		return { kind: "refused", reason: String(error instanceof Error ? error.message : error) };
	}
	if (!config) return { kind: "refused", reason: `This repository has no ${CONFIG_FILE}, so it names no checks to land with. Add one that lists them, commit it, and land again.` };
	if (!options.divergence.trim()) return { kind: "refused", reason: "Say how the result differs from what was asked, or write None." };
	if ((await gitOut(top, ["status", "--porcelain", "--untracked-files=no"])) !== "") return { kind: "refused", reason: "The checkout has uncommitted changes. Commit them, or set them aside, then land again." };
	if ((await git(top, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0) return { kind: "refused", reason: "The checkout is in the middle of a merge. Finish or abort it, then land again." };
	const tip = (await gitOut(top, ["rev-parse", "HEAD"]))!;
	const branch = (await gitOut(top, ["symbolic-ref", "--short", "-q", "HEAD"])) || tip.slice(0, 12);
	const { target, remote } = config;
	const remoteRef = `refs/remotes/${remote}/${target}`;
	const env = { ...process.env, ...(options.sessionId ? { PI_SESSION_ID: options.sessionId } : {}) };
	const limits = { silenceMs: options.silenceMs ?? SILENCE_MS, totalMs: options.totalMs ?? TOTAL_MS };
	await sweep(top);

	let lost = "";
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		options.progress?.(attempt === 1 ? `Fetching ${remote}/${target}` : `${remote}/${target} moved during the landing; starting again (attempt ${attempt} of ${ATTEMPTS})`);
		const fetched = await git(top, ["fetch", "--quiet", remote, `+refs/heads/${target}:${remoteRef}`]);
		if (fetched.code !== 0) return { kind: "refused", reason: `Could not fetch ${remote}/${target}: ${tail(fetched.out)}` };
		const base = (await gitOut(top, ["rev-parse", remoteRef]))!;
		if ((await git(top, ["merge-base", "--is-ancestor", tip, base])).code === 0) return { kind: "nothing", target: `${remote}/${target}` };

		const dir = mkdtempSync(join(tmpdir(), `${WORKTREE_PREFIX}${process.pid}-`));
		rmSync(dir, { recursive: true });
		try {
			const added = await git(top, ["worktree", "add", "--quiet", "--detach", dir, base]);
			if (added.code !== 0) return { kind: "refused", reason: `Could not make a worktree to land in: ${tail(added.out)}` };
			for (const command of config.setup) {
				options.progress?.(`Setting up: ${command}`);
				const done = await run("sh", ["-c", command], dir, env, limits, options.signal);
				if (done.code !== 0 || done.stopped) return { kind: "failed", command, why: done.stopped ? `setup was stopped: ${done.stopped}` : `setup exited with code ${done.code}`, failures: done.failures, tail: tail(done.out) };
			}
			options.progress?.(`Merging ${branch} into ${remote}/${target}`);
			const message = `Land ${branch}\n\nDivergence: ${options.divergence.trim()}`;
			const merged = await git(dir, ["merge", "--no-ff", "--no-edit", "-m", message, tip], env);
			if (merged.code !== 0) {
				const paths = ((await gitOut(dir, ["diff", "--name-only", "--diff-filter=U"])) ?? "").split("\n").filter(Boolean);
				await git(dir, ["merge", "--abort"]);
				if (paths.length > 0) return { kind: "conflict", paths };
				return { kind: "refused", reason: `The merge failed: ${tail(merged.out)}` };
			}
			const sha = (await gitOut(dir, ["rev-parse", "HEAD"]))!;
			const checkEnv = { ...env, LAND_BASE: base, LAND_TIP: tip };
			const flaky: string[] = [];
			for (const entry of config.checks) {
				const results = await Promise.all((Array.isArray(entry) ? entry : [entry]).map(command => check(command, dir, checkEnv, limits, options)));
				const failed = results.find(r => r.outcome === "failed");
				if (failed?.outcome === "failed") return { kind: "failed", command: failed.command, why: failed.why, failures: failed.failures, tail: failed.tail };
				flaky.push(...results.filter(r => r.outcome === "flaky").map(r => r.command));
			}
			options.progress?.(`Pushing to ${remote}/${target}`);
			// The checks above ran on exactly this commit, so the repository's pre-push hook would only run them again.
			const pushed = await git(dir, ["push", "--no-verify", "--quiet", remote, `${sha}:refs/heads/${target}`], env);
			if (pushed.code !== 0) {
				lost = tail(pushed.out);
				if (/\[rejected\]|non-fast-forward|fetch first|stale info/.test(pushed.out)) continue;
				return { kind: "rejected", why: lost };
			}
			await git(top, ["fetch", "--quiet", remote, `+refs/heads/${target}:${remoteRef}`]);
			return { kind: "landed", sha, base, flaky, local: await syncLocal(top, target, sha) };
		} finally {
			await git(top, ["worktree", "remove", "--force", dir]);
		}
	}
	return { kind: "rejected", why: `${remote}/${target} kept moving; ${ATTEMPTS} attempts lost the race. Last answer: ${lost}` };
}

/** What a landing's result tells the agent. */
export function describe(result: LandResult): string {
	switch (result.kind) {
		case "landed":
			return [
				`Landed ${result.sha.slice(0, 12)} on top of ${result.base.slice(0, 12)} and pushed it.`,
				...(result.flaky.length > 0 ? [`Flaky: ${result.flaky.join(", ")} failed once and passed when run again; say so in your reply.`] : []),
				result.local,
			].join("\n");
		case "nothing":
			return `Nothing to land: this commit is already on ${result.target}.`;
		case "refused":
			return `Not landed: ${result.reason}`;
		case "conflict":
			return `Not landed: merging into the target conflicts in ${result.paths.join(", ")}. Merge the target into your branch, resolve these, commit, and land again.`;
		case "failed":
			return [
				`Not landed: \`${result.command}\` failed on the merged result, as ${result.why}. Fix the cause on your branch, commit, and land again.`,
				...(result.failures.length > 0 ? [`Failing:\n${result.failures.map(f => `- ${f}`).join("\n")}`] : []),
				`Last output:\n${result.tail}`,
			].join("\n\n");
		case "rejected":
			return `Not landed: the push was refused. ${result.why}`;
		default: {
			const unhandled: never = result;
			return unhandled;
		}
	}
}
