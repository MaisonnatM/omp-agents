/**
 * **Run locally**: frees the branch from the linked worktree that has it checked out, checks it out in the main checkout,
 * installs when a lockfile changed, and starts the repository's services in terminal tabs, stopping its previous run's.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commonDir, git, worktreesOf } from "./git";
import { run, runShell } from "./proc";
import type { BranchRelease } from "./shared/git";
import type { RunOutcome, RunProfile } from "./shared/run-locally";
import type { Terminal, Terminals } from "./terminals";

/** The git config keys of a repository's run profile, shared by every worktree of it. */
const INSTALL_KEY = "omp-agents.run-install";
const SERVICE_KEY = "omp-agents.run-service";

/** The lockfiles whose change makes a run install again. */
export const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const STOP_WAIT_MS = 10_000;
const TERMINAL_SIZE = { cols: 120, rows: 30 };

/** A run refused before it changed anything, such as a main checkout with uncommitted changes; its message says why. */
export class RunRefused extends Error {}

/** What a run needs from the rest of the server: the worktree release that copying a branch also does. */
export interface RunLocallyEnv {
	releaseBranch(cwd: string, branch: string): Promise<BranchRelease>;
}

const configValues = async (cwd: string, key: string): Promise<string[]> => {
	const result = await run(["git", "-C", cwd, "config", "--local", "--get-all", key]);
	return result.code === 0 ? result.stdout.split("\n").filter(line => line.trim() !== "") : [];
};

/** The run profile kept in `cwd`'s repository, empty when none was saved. */
export async function readRunProfile(cwd: string): Promise<RunProfile> {
	const [install, services] = await Promise.all([configValues(cwd, INSTALL_KEY), configValues(cwd, SERVICE_KEY)]);
	return { install: install[0] ?? "", services };
}

/** Saves `profile` in `cwd`'s repository's git config. */
export async function saveRunProfile(cwd: string, profile: RunProfile): Promise<void> {
	await run(["git", "-C", cwd, "config", "--local", "--unset-all", INSTALL_KEY]);
	await run(["git", "-C", cwd, "config", "--local", "--unset-all", SERVICE_KEY]);
	if (profile.install) await git(cwd, "config", "--local", INSTALL_KEY, profile.install);
	for (const service of profile.services) await git(cwd, "config", "--local", "--add", SERVICE_KEY, service);
}

/** Whether a lockfile differs between commits `from` and `to` of the checkout `dir`. */
async function lockfileChanged(dir: string, from: string, to: string): Promise<boolean> {
	if (from === to) return false;
	return (await run(["git", "-C", dir, "diff", "--quiet", from, to, "--", ...LOCKFILES])).code === 1;
}

/** Whether `dir` declares JavaScript dependencies that are not installed. */
const missingModules = (dir: string): boolean => existsSync(join(dir, "package.json")) && !existsSync(join(dir, "node_modules"));

/** Checks `branch` out in the main checkout `main`, from `origin` when it has no local branch, and fast-forwards it to its upstream when it can. */
async function checkOut(main: string, branch: string): Promise<void> {
	const current = (await run(["git", "-C", main, "branch", "--show-current"])).stdout.trim();
	if (current !== branch) {
		const dirty = (await git(main, "status", "--porcelain", "--untracked-files=no")).trim();
		if (dirty) throw new RunRefused(`${main} has uncommitted changes; commit or stash them before running ${branch} there.`);
	}
	await run(["git", "-C", main, "fetch", "--quiet", "--no-tags", "origin", branch], { timeoutMs: 60_000 });
	if (current !== branch) {
		const checkout = await run(["git", "-C", main, "checkout", "--quiet", branch]);
		if (checkout.code !== 0) throw new RunRefused(`Cannot check out ${branch} in ${main}: ${checkout.stderr.trim() || `git exited ${checkout.code}`}`);
	}
	// A diverged branch stays as it is: you test what it holds.
	await run(["git", "-C", main, "merge", "--ff-only", "--quiet", "@{upstream}"]);
}

/** Each repository's running services, by its git directory, so the next run stops them first. */
export class RunLocally {
	readonly #running = new Map<string, Terminal[]>();

	constructor(
		private readonly env: RunLocallyEnv,
		private readonly terminals: Terminals,
	) {}

	async run(cwd: string, branch: string, profile: RunProfile): Promise<RunOutcome> {
		if (profile.services.length === 0) throw new RunRefused("Name at least one service to start.");
		const repository = await commonDir(cwd);
		await saveRunProfile(cwd, profile);
		const stopped = await this.#stop(repository);
		if (this.terminals.room < profile.services.length) throw new RunRefused(`Too many terminals are open to start ${profile.services.length} services. Close some first.`);
		// Read before the release, which may remove the worktree `cwd` is in, such as the session's own.
		const main = (await worktreesOf(cwd)).find(registration => registration.main);
		if (!main) throw new RunRefused(`${cwd} has no main checkout.`);
		const release = await this.env.releaseBranch(cwd, branch);
		let dir: string;
		let install: boolean;
		if (release.kind === "kept") {
			// The branch stays where it is checked out, so it runs there.
			dir = release.path;
			install = missingModules(dir);
		} else {
			dir = main.path;
			const before = (await run(["git", "-C", dir, "rev-parse", "HEAD"])).stdout.trim();
			await checkOut(dir, branch);
			install = missingModules(dir) || (before !== "" && (await lockfileChanged(dir, before, (await git(dir, "rev-parse", "HEAD")).trim())));
		}
		const installed = install && profile.install !== "";
		if (installed) {
			const result = await runShell(profile.install, dir, { timeoutMs: INSTALL_TIMEOUT_MS, maxOutput: 2000 });
			if (result.exitCode !== 0) throw new Error(`${profile.install} ${result.exitCode === null ? "was stopped" : `exited ${result.exitCode}`}:\n${result.output.trim()}`);
		}
		const started: Terminal[] = [];
		for (const service of profile.services) {
			const terminal = this.terminals.open(dir, TERMINAL_SIZE, service);
			if (!terminal) break;
			terminal.write(`${service}\n`);
			started.push(terminal);
		}
		this.#running.set(repository, started);
		return { dir, release, installed, terminals: started.map(terminal => terminal.info), stopped };
	}

	/** Hangs up on the repository's previous run's shells and waits for them to exit, so their ports are free; how many it stopped. */
	async #stop(repository: string): Promise<number> {
		const previous = this.#running.get(repository) ?? [];
		this.#running.delete(repository);
		const live = previous.filter(terminal => this.terminals.get(terminal.id) === terminal);
		for (const terminal of live) terminal.kill();
		await Promise.race([Promise.all(live.map(terminal => terminal.exited)), Bun.sleep(STOP_WAIT_MS)]);
		return live.length;
	}
}
