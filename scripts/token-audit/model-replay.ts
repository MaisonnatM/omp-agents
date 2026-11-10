/**
 * Replays past worker tasks on several models and compares what each costs and whether its change holds up,
 * so a cheaper model for `poteto-agent` and `task` workers is chosen on evidence.
 *
 * - `candidates` lists recent worker subagent sessions as task entries: the prompt they got, the repository,
 *   and the main commit at that time as the base, leaving out tasks `--out` already holds, so a weekly run
 *   gets only new ones. Save them to a file and keep the ones worth replaying.
 * - `run` replays each task on each model in a fresh repository holding only the base's history, with no remote,
 *   in a macOS sandbox that hides the task's checkouts and their sessions and leaves git and gh no way to reach a remote,
 *   so a replay cannot copy later work, push, or land. It prices the run from its session files, saves its diff, and
 *   runs the repository's `.omp/land.json` setup and checks.
 *   Every model role and fallback chain points at the replayed model, so its subagents run on it and a usage limit
 *   fails the replay instead of handing it to another model; `answeredBy` counts the requests per model as proof.
 * - `judge` shows a judge model the task, the `--baseline` model's diff, and another model's diff in random order,
 *   per task and model, and keeps its verdict. A replay another model answered part of is not judged.
 * - `summary` prints the comparison per model; `run` and `judge` end with it.
 *
 * Usage:
 *   bun scripts/token-audit/model-replay.ts candidates [--days 14] [--agents poteto-agent,task] [--repo <path>] > tasks.json
 *   bun scripts/token-audit/model-replay.ts run --tasks tasks.json --models anthropic/claude-opus-5-5:auto,anthropic/claude-sonnet-5-5:auto [--out <dir>]
 *   bun scripts/token-audit/model-replay.ts judge [--out <dir>] [--judge anthropic/claude-opus-5-5] [--baseline anthropic/claude-opus-5-5:auto]
 * `--out` defaults to `~/.cache/omp-model-replay` and must sit outside every checkout: a replay nested in one read it.
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sessionPaths } from "../../src/omp/modules";

interface Task {
	id: string;
	agent: string;
	repo: string;
	base: string;
	at: string;
	originalCost: number;
	originalRequests: number;
	/** Absolute checkout paths the prompt names; a replay rewrites each to its own clone. */
	paths: string[];
	prompt: string;
}

interface Result {
	task: string;
	model: string;
	exitCode: number | null;
	minutes: number;
	cost: number;
	requests: number;
	outputTokens: number;
	filesChanged: number;
	linesChanged: number;
	checks: { command: string; passed: boolean; failures: string[] }[];
	/** Requests per `provider/model` that answered; any model but the replayed one makes the replay unfair. */
	answeredBy: Record<string, number>;
}

interface Verdict {
	task: string;
	models: [string, string];
	winner: string | null;
	defects: Record<string, string[]>;
}

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		db: { type: "string", default: join(homedir(), ".omp", "stats.db") },
		days: { type: "string", default: "14" },
		agents: { type: "string", default: "poteto-agent,task" },
		repo: { type: "string" },
		tasks: { type: "string" },
		models: { type: "string" },
		out: { type: "string", default: join(homedir(), ".cache", "omp-model-replay") },
		"max-cost": { type: "string", default: "15" },
		"max-time": { type: "string", default: "45m" },
		judge: { type: "string", default: "anthropic/claude-opus-5-5" },
		baseline: { type: "string", default: "anthropic/claude-opus-5-5:auto" },
	},
});
const out = resolve(values.out);

function sh(command: string, cwd: string, env: Record<string, string> = {}): { ok: boolean; output: string } {
	const run = spawnSync("sh", ["-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28 });
	return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

function git(cwd: string, ...args: string[]): string {
	const run = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
	if (run.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${run.stderr}`);
	return run.stdout.trim();
}

const slug = (model: string) => model.replace(/[^\w.-]+/g, "_");
/** A model selector without its `:level` suffix, as session files name the model that answered. */
const bare = (model: string) => model.replace(/:[^/]*$/, "");
const pinned = (result: Result) => Object.keys(result.answeredBy).every(model => model === bare(result.model));

/**
 * A config overlay that runs every role on `model` with no fallback, written to `dir`, so omp never swaps in
 * another model on a usage limit or for a subagent. The roles are the ones the user's config names.
 */
function pinnedConfig(model: string, dir: string): string {
	const file = join(homedir(), ".omp", "agent", "config.yml");
	const config = (existsSync(file) ? Bun.YAML.parse(readFileSync(file, "utf8")) : {}) as {
		modelRoles?: Record<string, unknown>;
		retry?: { fallbackChains?: Record<string, unknown> };
	};
	const roles = new Set(["default", "task", ...Object.keys(config.modelRoles ?? {}), ...Object.keys(config.retry?.fallbackChains ?? {})]);
	const overlay = {
		modelRoles: Object.fromEntries([...roles].map(role => [role, model])),
		retry: { usageAwareFallback: false, fallbackChains: Object.fromEntries([...roles].map(role => [role, []])) },
	};
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "pinned-config.yml");
	writeFileSync(path, JSON.stringify(overlay, null, "\t"));
	return path;
}
const jsonLines = (file: string) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, unknown>);

function candidates(): void {
	const agents = new Set(values.agents.split(","));
	const db = new Database(values.db, { readonly: true });
	const files = db
		.query<{ file: string; requests: number; total: number }, [number]>(
			`SELECT session_file AS file, COUNT(*) AS requests, TOTAL(cost_total) AS total
			FROM messages WHERE timestamp >= ? AND agent_type = 'subagent' GROUP BY session_file ORDER BY total DESC`,
		)
		.all(Date.now() - Number(values.days) * 86_400_000);
	const tasks: Task[] = [];
	let unreadable = 0;
	for (const { file, requests, total } of files) {
		if (!existsSync(file)) continue;
		const entries = jsonLines(file);
		const header = entries.find(e => e.type === "session");
		const init = entries.find(e => e.type === "session_init");
		if (!header || !init || !agents.has(String(init.agent)) || typeof init.task !== "string") continue;
		const id = String(header.id).slice(-8);
		if (existsSync(join(out, id))) continue;
		const prompt = init.task;
		if (/\b(local|agent):\/\//.test(prompt)) {
			unreadable += 1;
			continue;
		}
		const cwd = String(header.cwd);
		if (!existsSync(cwd)) continue;
		let repo: string;
		try {
			repo = dirname(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"));
		} catch {
			continue;
		}
		if (values.repo && resolve(values.repo) !== repo) continue;
		const at = String(header.timestamp);
		const target = existsSync(join(repo, ".omp", "land.json"))
			? (JSON.parse(readFileSync(join(repo, ".omp", "land.json"), "utf8")) as { target?: string }).target ?? "main"
			: "main";
		// A commit the prompt names, such as "head `bf45e…`", is the state the worker started from; else main at that time.
		const named = (prompt.match(/\b[0-9a-f]{7,40}\b/g) ?? []).find(sha => {
			try {
				return git(repo, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`) !== "";
			} catch {
				return false;
			}
		});
		const base = named ? git(repo, "rev-parse", `${named}^{commit}`) : git(repo, "rev-list", "-1", "--first-parent", `--before=${at}`, target);
		if (!base) continue;
		// The repository and its worktrees: `omp-agents`, `omp-agents-wt-x`, `omp-agents-wt/x`, `hameau-9.4`.
		const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const checkout = new RegExp(`${escape(dirname(repo))}/${escape(basename(repo))}(?:-wt/[\\w.-]*\\w|[\\w.-]*\\w)?`, "g");
		const paths = [...new Set(prompt.match(checkout) ?? [])].sort((a, b) => b.length - a.length);
		tasks.push({
			id,
			agent: String(init.agent),
			repo,
			base,
			at,
			originalCost: Number(total.toFixed(2)),
			originalRequests: requests,
			paths,
			prompt,
		});
	}
	if (unreadable > 0) console.error(`skipped ${unreadable} tasks whose prompt points at local:// or agent:// files a replay cannot read`);
	console.log(JSON.stringify(tasks, null, "\t"));
}

/** Sums every request in a replay's session files, its subagents' files included, and counts who answered each. */
function price(dir: string): Pick<Result, "cost" | "requests" | "outputTokens" | "answeredBy"> {
	const total = { cost: 0, requests: 0, outputTokens: 0, answeredBy: {} as Record<string, number> };
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

/** The error a replay's own session ended on, such as a usage limit, or null when the model got to answer. */
function endedOnError(dir: string): string | null {
	if (!existsSync(dir)) return "omp left no session";
	const main = readdirSync(dir).filter(name => name.endsWith(".jsonl"));
	const last = main
		.flatMap(name => jsonLines(join(dir, name)))
		.map(entry => entry.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined)
		.findLast(message => message?.role === "assistant");
	return !last ? "the model never answered" : last.stopReason === "error" ? (last.errorMessage ?? "unknown error") : null;
}

function landConfig(repo: string, base: string): { setup: string[]; checks: string[] } {
	try {
		const config = JSON.parse(git(repo, "show", `${base}:.omp/land.json`)) as { setup?: string[]; checks?: (string | string[])[] };
		return { setup: config.setup ?? [], checks: (config.checks ?? []).flat() };
	} catch {
		return { setup: [], checks: [] };
	}
}

/**
 * A repository at the task's base, after the repository's land setup: it holds the base's history and nothing after it,
 * no branch, no tag, and no remote, so neither `git log --all` nor a commit's hash leads to the work that followed.
 */
function prepare(task: Task, dir: string): string {
	const clone = join(dir, "repo");
	mkdirSync(dir, { recursive: true });
	if (!existsSync(clone)) {
		git(dir, "init", "--quiet", clone);
		git(clone, "fetch", "--quiet", "--no-tags", task.repo, git(task.repo, "rev-parse", "--verify", `${task.base}^{commit}`).trim());
		git(clone, "checkout", "--quiet", "--detach", "FETCH_HEAD");
		rmSync(join(clone, ".git", "FETCH_HEAD"));
	}
	for (const command of landConfig(task.repo, task.base).setup) {
		const step = sh(command, clone);
		if (!step.ok) throw new Error(`setup "${command}" failed in ${clone}:\n${step.output}`);
	}
	return clone;
}

/** Runs the land checks; `failures` names each failing `bun test` case, so one broken at the base is not blamed on a replay. */
function check(task: Task, clone: string, dir: string): Result["checks"] {
	const log: string[] = [];
	const checks = landConfig(task.repo, task.base).checks.map(command => {
		const run = sh(command, clone, { LAND_BASE: task.base });
		log.push(`$ ${command}\n${run.output}\n${run.ok ? "passed" : "FAILED"}\n`);
		const failures = [...run.output.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map(match => match[1]!);
		return { command, passed: run.ok, failures };
	});
	writeFileSync(join(dir, "checks.log"), log.join("\n"));
	return checks;
}

/**
 * The `sandbox-exec` arguments and environment that run a replay's omp so it sees only its own repository: the sandbox
 * hides the task's repository, its worktrees, and their omp session folders, where the original worker's change and
 * transcript sit; git rewrites every remote address to a missing folder, and gh has no sign-in.
 * Without them, replays copied the original change from a worktree and force-pushed a branch of the real repository.
 */
function confined(task: Task, dir: string, args: string[]): { sandboxArgs: string[]; env: Record<string, string | undefined> } {
	if (process.platform !== "darwin") throw new Error("run needs macOS's sandbox-exec to hide the task's checkouts from a replay");
	const startingWith = (path: string) => `(regex #"^${path.replace(/[.*+?^$()|[\]{}\\"]/g, "\\$&")}($|[-/])")`;
	const sessions = sessionPaths.sessionDirForCwd(task.repo, join(homedir(), ".omp", "agent", "sessions"));
	const profile = `(version 1)(allow default)(deny file-read* file-write* ${startingWith(task.repo)} ${startingWith(sessions)})`;
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

/** Replays one task on one model; null when the model could not answer, whose folder is removed so the next run retries it. */
function replay(task: Task, model: string): Result | null {
	const dir = join(out, task.id, slug(model));
	const clone = prepare(task, dir);
	const prompt = task.paths.reduce((text, path) => text.replaceAll(path, clone), task.prompt);
	writeFileSync(join(dir, "prompt.md"), prompt);
	const cacheTail = join(homedir(), ".omp", "agent", "extensions", "cache-tail.ts");
	const args = ["-p", "--model", model, "--config", pinnedConfig(model, dir), "--session-dir", join(dir, "sessions"), "--no-title", "--no-extensions"];
	if (existsSync(cacheTail)) args.push("-e", cacheTail);
	args.push("--max-cost", values["max-cost"], "--max-time", values["max-time"], prompt);
	const log = openSync(join(dir, "output.txt"), "w");
	const started = Date.now();
	const { sandboxArgs, env } = confined(task, dir, args);
	const run = spawnSync("sandbox-exec", sandboxArgs, { cwd: clone, env, stdio: ["ignore", log, log] });
	closeSync(log);
	const minutes = (Date.now() - started) / 60_000;
	const error = endedOnError(join(dir, "sessions"));
	if (error) {
		console.error(`  ${model} could not answer, so the next run retries it: ${error}`);
		rmSync(dir, { recursive: true, force: true });
		return null;
	}

	git(clone, "add", "-A");
	writeFileSync(join(dir, "change.diff"), git(clone, "diff", "--cached", task.base));
	const numstat = git(clone, "diff", "--cached", "--numstat", task.base).split("\n").filter(Boolean);
	const linesChanged = numstat.reduce((sum, row) => {
		const [added, removed] = row.split("\t");
		return sum + (Number(added) || 0) + (Number(removed) || 0);
	}, 0);

	const checks = check(task, clone, dir);

	const result: Result = {
		task: task.id,
		model,
		exitCode: run.status,
		minutes: Number(minutes.toFixed(1)),
		...price(join(dir, "sessions")),
		filesChanged: numstat.length,
		linesChanged,
		checks,
	};
	writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, "\t"));
	return result;
}

function runAll(): void {
	if (!values.tasks || !values.models) throw new Error("run needs --tasks <file> and --models <a,b,...>");
	const tasks = JSON.parse(readFileSync(values.tasks, "utf8")) as Task[];
	mkdirSync(out, { recursive: true });
	const enclosing = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: out, encoding: "utf8" });
	if (enclosing.status === 0) throw new Error(`--out ${out} is inside the checkout ${enclosing.stdout.trim()}; a replay there reads it, so pick a folder outside every checkout`);
	writeFileSync(join(out, "tasks.json"), JSON.stringify(tasks, null, "\t"));
	for (const task of tasks) {
		const baseFile = join(out, task.id, "base-checks.json");
		if (!existsSync(baseFile)) {
			console.error(`checking ${task.id} at its base`);
			const dir = join(out, task.id, "base");
			writeFileSync(baseFile, JSON.stringify(check(task, prepare(task, dir), dir), null, "\t"));
		}
		for (const model of values.models.split(",")) {
			if (existsSync(join(out, task.id, slug(model), "result.json"))) continue;
			console.error(`replaying ${task.id} on ${model}`);
			const result = replay(task, model);
			if (!result) continue;
			console.error(`  $${result.cost.toFixed(2)}, ${result.requests} requests, ${result.minutes} min, exit ${result.exitCode}`);
			if (!pinned(result)) console.error(`  other models answered too, so this replay is left out: ${JSON.stringify(result.answeredBy)}`);
		}
	}
}

/** Every replay's result, read from `<out>/<task>/<model>/result.json` without walking the clones. */
function results(): Result[] {
	if (!existsSync(out)) return [];
	return readdirSync(out, { withFileTypes: true })
		.filter(task => task.isDirectory())
		.flatMap(task => readdirSync(join(out, task.name)).map(model => join(out, task.name, model, "result.json")))
		.filter(file => existsSync(file))
		.map(file => JSON.parse(readFileSync(file, "utf8")) as Result);
}

/**
 * Whether a replay breaks nothing that worked at its base: a check that passed still passes, and a test suite
 * that failed at the base fails only on cases that already failed there. A check that failed at the base
 * without naming cases, such as the changelog check, says nothing about the replay and is skipped.
 */
function keepsBaseChecks(result: Result): boolean {
	const file = join(out, result.task, "base-checks.json");
	const base: Result["checks"] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
	return base.every(before => {
		const after = result.checks.find(c => c.command === before.command);
		if (!after) return !before.passed;
		if (after.passed) return true;
		if (before.passed) return false;
		if (before.failures.length === 0) return true;
		return after.failures.length > 0 && after.failures.every(name => before.failures.includes(name));
	});
}

function judgeAll(): void {
	const verdicts: Verdict[] = existsSync(join(out, "judge.json")) ? JSON.parse(readFileSync(join(out, "judge.json"), "utf8")) : [];
	const byTask = Map.groupBy(results(), r => r.task);
	for (const [id, runs] of byTask) {
		const first = runs.find(r => r.model === values.baseline);
		if (!first || !pinned(first)) continue;
		for (const other of runs) {
			if (other === first || !pinned(other)) continue;
			if (verdicts.some(v => v.task === id && v.models.includes(first.model) && v.models.includes(other.model))) continue;
			const pair: [Result, Result] = Math.random() < 0.5 ? [first, other] : [other, first];
			const [a, b] = pair.map(r => join(out, id, slug(r.model), "change.diff"));
			const prompt = [
				"You review two attempts at the same coding task, made from the same commit. Judge which change better does what the task asks, is correct, and is ready to merge.",
				`Read the task at ${join(out, id, slug(first.model), "prompt.md")}, change A at ${a}, and change B at ${b}.`,
				"An empty change did nothing. Ignore which attempt is longer; size is not quality. Ignore differences in the absolute checkout paths.",
				`Checks the repository runs, passed per change: A ${JSON.stringify(pair[0].checks)}, B ${JSON.stringify(pair[1].checks)}.`,
				'End your reply with one line of JSON and nothing after it: {"winner": "A" | "B" | "tie", "A_defects": ["..."], "B_defects": ["..."]}',
			].join("\n");
			console.error(`judging ${id}: ${first.model} vs ${other.model}`);
			const judgeArgs = ["-p", "--no-session", "--no-title", "--no-extensions", "--tools", "read", "--model", values.judge, "--config", pinnedConfig(values.judge, out)];
			const run = spawnSync("omp", [...judgeArgs, prompt], {
				cwd: out,
				encoding: "utf8",
				maxBuffer: 1 << 28,
			});
			const line = run.stdout.trim().split("\n").reverse().find(l => l.trim().startsWith("{"));
			if (!line) throw new Error(`judge gave no verdict for ${id}:\n${run.stdout}${run.stderr}`);
			const parsed = JSON.parse(line) as { winner: string; A_defects: string[]; B_defects: string[] };
			verdicts.push({
				task: id,
				models: [first.model, other.model],
				winner: parsed.winner === "A" ? pair[0].model : parsed.winner === "B" ? pair[1].model : null,
				defects: { [pair[0].model]: parsed.A_defects, [pair[1].model]: parsed.B_defects },
			});
			writeFileSync(join(out, "judge.json"), JSON.stringify(verdicts, null, "\t"));
		}
	}
}

function summary(): void {
	const verdicts: Verdict[] = existsSync(join(out, "judge.json")) ? JSON.parse(readFileSync(join(out, "judge.json"), "utf8")) : [];
	const rows = [...Map.groupBy(results(), r => r.model)].map(([model, all]) => {
		const runs = all.filter(pinned);
		const judged = verdicts.filter(v => v.models.includes(model));
		return {
			model,
			tasks: runs.length,
			"left out, other model answered": all.length - runs.length,
			"keeps base checks": `${runs.filter(keepsBaseChecks).length}/${runs.length}`,
			"empty changes": runs.filter(r => r.filesChanged === 0).length,
			"total $": runs.reduce((s, r) => s + r.cost, 0).toFixed(2),
			"$ per task": (runs.reduce((s, r) => s + r.cost, 0) / runs.length).toFixed(2),
			"requests per task": Math.round(runs.reduce((s, r) => s + r.requests, 0) / runs.length),
			"minutes per task": (runs.reduce((s, r) => s + r.minutes, 0) / runs.length).toFixed(1),
			"judge wins/ties/losses": `${judged.filter(v => v.winner === model).length}/${judged.filter(v => v.winner === null).length}/${judged.filter(v => v.winner && v.winner !== model).length}`,
			"defects found": judged.reduce((s, v) => s + (v.defects[model]?.length ?? 0), 0),
		};
	});
	console.table(rows);
}

switch (positionals[0]) {
	case "candidates":
		candidates();
		break;
	case "run":
		runAll();
		summary();
		break;
	case "judge":
		judgeAll();
		summary();
		break;
	case "summary":
		summary();
		break;
	default:
		throw new Error("usage: model-replay.ts candidates | run | judge | summary (see the comment at the top)");
}
