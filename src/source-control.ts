/**
 * Settings › Source control providers on the server: whether `gh` and `gt` are signed in, the automatic pulls that
 * keep each workspace repository's default branch current while it has no local changes or commits, and whether a
 * merge cleans up after itself.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, git, worktreesOf } from "./git";
import { JsonFile } from "./fs";
import { errorText, isObject } from "./json";
import { HOME } from "./paths";
import { run, runChecked } from "./proc";
import { applySourceControl, DEFAULT_SOURCE_CONTROL, type ProviderStatus, type PullOutcome, type PullRepo, type SourceControlAnswer, type SourceControlChange, type SourceControlSettings } from "./shared/source-control";
import { SerialLane } from "./serial-lane";

const FETCH_TIMEOUT_MS = 60_000;

async function commitOf(dir: string, ref: string): Promise<string | null> {
	const { stdout, code } = await run(["git", "-C", dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
	return code === 0 ? stdout.trim() : null;
}

const skipped = (reason: Extract<PullOutcome, { kind: "skipped" }>["reason"], detail: string | null = null): PullOutcome => ({ kind: "skipped", reason, detail });

/**
 * Fast-forwards the default branch of the repository `dir` is in to `origin`'s, unless the branch has commits `origin`
 * lacks or the worktree that has it checked out has changes to tracked files. A branch no worktree has checked out
 * moves without a checkout.
 */
export async function pullDefaultBranch(dir: string): Promise<PullOutcome> {
	const head = await run(["git", "-C", dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
	if (head.code !== 0 || !head.stdout.startsWith("origin/")) return skipped("no-default-branch", "origin names no default branch");
	const branch = head.stdout.trim().slice("origin/".length);
	try {
		await runChecked(["git", "-C", dir, "fetch", "--quiet", "origin", branch], { timeoutMs: FETCH_TIMEOUT_MS });
	} catch (err) {
		return skipped("failed", errorText(err));
	}
	const [local, remote] = await Promise.all([commitOf(dir, `refs/heads/${branch}`), commitOf(dir, `refs/remotes/origin/${branch}`)]);
	if (!local || !remote) return skipped("no-default-branch", `No local ${branch} branch`);
	if (local === remote) return { kind: "current" };
	const ancestor = await run(["git", "-C", dir, "merge-base", "--is-ancestor", local, remote]);
	if (ancestor.code !== 0) return skipped("commits", `${branch} has commits origin/${branch} lacks`);
	const checkout = (await worktreesOf(dir)).find(worktree => worktree.branch === branch && worktree.prunable === null);
	try {
		if (checkout) {
			if ((await git(checkout.path, "status", "--porcelain", "--untracked-files=no")).trim()) return skipped("changes", `${checkout.path} has changes`);
			await git(checkout.path, "merge", "--ff-only", "--quiet", remote);
		} else await git(dir, "update-ref", `refs/heads/${branch}`, remote, local);
	} catch (err) {
		return skipped("failed", errorText(err));
	}
	return { kind: "pulled", commits: Number((await git(dir, "rev-list", "--count", `${local}..${remote}`)).trim()) };
}

/** The main checkout of each repository among `cwds`, each once, in the order its first workspace comes. */
export async function repositoriesOf(cwds: readonly string[]): Promise<string[]> {
	const mains = await Promise.all(cwds.map(cwd => worktreesOf(cwd).then(rows => (rows[0] && !rows[0].bare ? canonical(rows[0].path) : null), () => null)));
	return [...new Set(mains.filter(main => main !== null))];
}

async function githubStatus(): Promise<ProviderStatus> {
	if (!Bun.which("gh")) return { provider: "github", state: "missing", account: null };
	const { stdout, code } = await run(["gh", "api", "user", "--jq", ".login"]);
	return code === 0 && stdout.trim() ? { provider: "github", state: "signed-in", account: stdout.trim() } : { provider: "github", state: "signed-out", account: null };
}

/** `gt auth --token` saves the token in Graphite's user config. */
async function graphiteStatus(): Promise<ProviderStatus> {
	if (!Bun.which("gt")) return { provider: "graphite", state: "missing", account: null };
	const config = await readFile(join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "graphite", "user_config"), "utf8").then(
		text => JSON.parse(text) as unknown,
		() => null,
	);
	const signedIn = isObject(config) && typeof config.authToken === "string" && config.authToken !== "";
	return { provider: "graphite", state: signedIn ? "signed-in" : "signed-out", account: null };
}

/** A file from before the cleanup setting reads with it on. */
function parseSettings(value: unknown): SourceControlSettings | null {
	if (!isObject(value) || typeof value.on !== "boolean" || !isObject(value.repos)) return null;
	if (value.cleanUp !== undefined && typeof value.cleanUp !== "boolean") return null;
	const repos = Object.entries(value.repos);
	if (!repos.every(([, on]) => typeof on === "boolean")) return null;
	return { on: value.on, repos: Object.fromEntries(repos) as Record<string, boolean>, cleanUp: value.cleanUp ?? DEFAULT_SOURCE_CONTROL.cleanUp };
}

/** The settings kept in `source-control.json`, and the last pull of each repository since the server started. */
export class SourceControl {
	readonly #file: JsonFile<SourceControlSettings>;
	#settings: SourceControlSettings;
	readonly #last = new Map<string, NonNullable<PullRepo["last"]>>();
	readonly #pulls = new SerialLane();

	constructor(path: string) {
		this.#file = new JsonFile(path, { parse: parseSettings, holds: "the source control settings", onInvalid: "aside", indent: "\t" });
		this.#settings = this.#file.load() ?? DEFAULT_SOURCE_CONTROL;
	}

	/** Whether a merge ends the sessions it leaves with nothing to do. */
	get cleanUp(): boolean {
		return this.#settings.cleanUp;
	}

	/** Applies `change` and saves; whether it changed anything. */
	apply(change: SourceControlChange): boolean {
		const next = applySourceControl(this.#settings, change);
		if (next === this.#settings) return false;
		this.#settings = next;
		this.#file.save(next);
		return true;
	}

	/** Pulls the default branch of each repository among `cwds` whose pulls are on, one repository at a time, after any pull under way. */
	pull(cwds: readonly string[]): Promise<void> {
		return this.#pulls.run(async () => {
			for (const repo of await repositoriesOf(cwds)) {
				if (!(this.#settings.repos[repo] ?? this.#settings.on)) continue;
				const outcome = await pullDefaultBranch(repo).catch((err: unknown) => skipped("failed", errorText(err)));
				this.#last.set(repo, { at: Date.now(), outcome });
			}
		});
	}

	async answer(cwds: readonly string[]): Promise<SourceControlAnswer> {
		const [providers, repos] = await Promise.all([Promise.all([githubStatus(), graphiteStatus()]), repositoriesOf(cwds)]);
		return {
			providers,
			autoPull: { on: this.#settings.on, repos: this.#settings.repos },
			cleanUp: this.#settings.cleanUp,
			repos: repos.map(path => ({ path, on: this.#settings.repos[path] ?? null, last: this.#last.get(path) ?? null })),
		};
	}
}
