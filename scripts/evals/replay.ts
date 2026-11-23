/**
 * Runs omp headless on a past task in a confined clone, and prices the run from its session files.
 * `scripts/token-audit/model-replay.ts` and `scripts/evals/run.ts` share it, so both replay a task the same way.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sessionPaths } from "../../src/omp/modules";

export interface Usage {
	cost: number;
	requests: number;
	outputTokens: number;
	/** Requests per `provider/model` that answered; any model but the replayed one makes the replay unfair. */
	answeredBy: Record<string, number>;
}

export function sh(command: string, cwd: string, env: Record<string, string> = {}, timeout?: number): { ok: boolean; output: string } {
	const run = spawnSync("sh", ["-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28, timeout });
	return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

export function git(cwd: string, ...args: string[]): string {
	const run = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
	if (run.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${run.stderr}`);
	return run.stdout.trim();
}

/** A model selector without its `:level` suffix, as session files name the model that answered. */
export const bare = (model: string) => model.replace(/:[^/]*$/, "");

export const jsonLines = (file: string) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, unknown>);

/**
 * A config overlay that runs every role on `model` with no fallback, written to `dir`, so omp never swaps in
 * another model on a usage limit or for a subagent. The roles are the ones the user's config names.
 * `disabled` adds `disabledExtensions` ids, such as `extension-module:ship` or `skill:ship`, to the user's own list.
 */
export function pinnedConfig(model: string, dir: string, disabled: string[] = []): string {
	const file = join(homedir(), ".omp", "agent", "config.yml");
	const config = (existsSync(file) ? Bun.YAML.parse(readFileSync(file, "utf8")) : {}) as {
		modelRoles?: Record<string, unknown>;
		retry?: { fallbackChains?: Record<string, unknown> };
		disabledExtensions?: string[];
	};
	const roles = new Set(["default", "task", ...Object.keys(config.modelRoles ?? {}), ...Object.keys(config.retry?.fallbackChains ?? {})]);
	const overlay = {
		modelRoles: Object.fromEntries([...roles].map(role => [role, model])),
		retry: { usageAwareFallback: false, fallbackChains: Object.fromEntries([...roles].map(role => [role, []])) },
		...(disabled.length > 0 && { disabledExtensions: [...new Set([...(config.disabledExtensions ?? []), ...disabled])] }),
	};
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "pinned-config.yml");
	writeFileSync(path, JSON.stringify(overlay, null, "\t"));
	return path;
}

/** Sums every request in a run's session files, its subagents' files included, and counts who answered each. */
export function price(dir: string): Usage {
	const total: Usage = { cost: 0, requests: 0, outputTokens: 0, answeredBy: {} };
	if (!existsSync(dir)) return total;
	for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
		if (!name.endsWith(".jsonl")) continue;
		for (const entry of jsonLines(join(dir, name))) {
			const message = entry.message as
				| { role?: string; provider?: string; model?: string; usage?: { output?: number; cost?: { total?: number } } }
				| undefined;
			if (entry.type !== "message" || message?.role !== "assistant" || !message.usage) continue;
			total.cost += message.usage.cost?.total ?? 0;
			total.outputTokens += message.usage.output ?? 0;
			total.requests += 1;
			const answered = `${message.provider}/${message.model}`;
			total.answeredBy[answered] = (total.answeredBy[answered] ?? 0) + 1;
		}
	}
	return total;
}

/** The error a run's own session ended on, such as a usage limit, or null when the model got to answer. */
export function endedOnError(dir: string): string | null {
	if (!existsSync(dir)) return "omp left no session";
	const main = readdirSync(dir).filter(name => name.endsWith(".jsonl"));
	const last = main
		.flatMap(name => jsonLines(join(dir, name)))
		.map(entry => entry.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined)
		.findLast(message => message?.role === "assistant");
	return !last ? "the model never answered" : last.stopReason === "error" ? (last.errorMessage ?? "unknown error") : null;
}

export function landConfig(repo: string, base: string): { setup: string[]; checks: string[] } {
	try {
		const config = JSON.parse(git(repo, "show", `${base}:.omp/land.json`)) as { setup?: string[]; checks?: (string | string[])[] };
		return { setup: config.setup ?? [], checks: (config.checks ?? []).flat() };
	} catch {
		return { setup: [], checks: [] };
	}
}

/**
 * A repository at `base` in `<dir>/repo`, after the repository's land setup: it holds the base's history and nothing after it,
 * no branch, no tag, and no remote, so neither `git log --all` nor a commit's hash leads to the work that followed.
 */
export function prepare(repo: string, base: string, dir: string): string {
	const clone = join(dir, "repo");
	mkdirSync(dir, { recursive: true });
	if (!existsSync(clone)) {
		git(dir, "init", "--quiet", clone);
		git(clone, "fetch", "--quiet", "--no-tags", repo, git(repo, "rev-parse", "--verify", `${base}^{commit}`).trim());
		git(clone, "checkout", "--quiet", "--detach", "FETCH_HEAD");
		rmSync(join(clone, ".git", "FETCH_HEAD"));
	}
	for (const command of landConfig(repo, base).setup) {
		const step = sh(command, clone);
		if (!step.ok) throw new Error(`setup "${command}" failed in ${clone}:\n${step.output}`);
	}
	return clone;
}

/**
 * The `sandbox-exec` arguments and environment that run omp so it sees only its own clone: the sandbox
 * hides `repo`, its worktrees, and their omp session folders, where the original change and
 * transcript sit; git rewrites every remote address to a missing folder, and gh has no sign-in.
 * Without them, replays copied the original change from a worktree and force-pushed a branch of the real repository.
 */
export function confined(repo: string, dir: string, args: string[]): { sandboxArgs: string[]; env: Record<string, string | undefined> } {
	if (process.platform !== "darwin") throw new Error("a replay needs macOS's sandbox-exec to hide the task's checkouts from it");
	const startingWith = (path: string) => `(regex #"^${path.replace(/[.*+?^$()|[\]{}\\"]/g, "\\$&")}($|[-/])")`;
	const sessions = sessionPaths.sessionDirForCwd(repo, join(homedir(), ".omp", "agent", "sessions"));
	const profile = `(version 1)(allow default)(deny file-read* file-write* ${startingWith(repo)} ${startingWith(sessions)})`;
	const remotes = ["https://", "http://", "ssh://", "git://", "git@"];
	const gh = join(dir, "gh");
	mkdirSync(gh, { recursive: true });
	const env: Record<string, string | undefined> = {
		...process.env,
		GH_CONFIG_DIR: gh,
		GH_TOKEN: undefined,
		GITHUB_TOKEN: undefined,
		GH_ENTERPRISE_TOKEN: undefined,
		GITHUB_ENTERPRISE_TOKEN: undefined,
		GIT_CONFIG_COUNT: String(remotes.length),
	};
	for (const [index, prefix] of remotes.entries()) {
		env[`GIT_CONFIG_KEY_${index}`] = "url./nonexistent/model-replay-has-no-remote/.insteadOf";
		env[`GIT_CONFIG_VALUE_${index}`] = prefix;
	}
	return { sandboxArgs: ["-p", profile, "omp", ...args], env };
}

/** Files and lines the clone changed since `base`, counting new files; stages everything to see them. */
export function changeSize(clone: string, base: string): { filesChanged: number; linesChanged: number; diff: string } {
	git(clone, "add", "-A");
	const numstat = git(clone, "diff", "--cached", "--numstat", base).split("\n").filter(Boolean);
	const linesChanged = numstat.reduce((sum, row) => {
		const [added, removed] = row.split("\t");
		return sum + (Number(added) || 0) + (Number(removed) || 0);
	}, 0);
	return { filesChanged: numstat.length, linesChanged, diff: git(clone, "diff", "--cached", base) };
}
