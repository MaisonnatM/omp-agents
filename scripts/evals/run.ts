/**
 * Runs the eval set: each task's prompt through `omp -p` with the full harness, in a confined clone at the task's base,
 * then writes the task's hidden tests from its landed commit and records whether its check passes, with cost and minutes,
 * as one line per run in a JSONL results file.
 *
 * - `--disable-extensions a,b` and `--disable-skills c,d` add a decay check: besides the full harness, the set runs once
 *   per listed component with only that component turned off, through omp's `disabledExtensions`, and the summary prints
 *   each component's pass-rate and cost delta against the full harness.
 * - A run already in the results file is skipped, so a stopped run resumes; a run whose model could not answer is
 *   recorded with its error, left out of the summary, and retried next time.
 * - `--dry-run` does everything but call the model: it prints the omp command, applies the landed change in place of
 *   the agent's, and runs the hidden check, which must pass; it records nothing.
 *
 * Usage:
 *   bun scripts/evals/run.ts [--tasks scripts/evals/tasks.json] [--only id,id] [--runs 3] [--model anthropic/claude-opus-5-5:auto]
 *     [--disable-extensions ship,bash-guard] [--disable-skills ship] [--out ~/.cache/omp-evals] [--max-cost 5] [--max-time 30m] [--dry-run]
 *   bun scripts/evals/run.ts summary [--out ~/.cache/omp-evals]
 * `--out` must sit outside every checkout: a run nested in one reads it.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type EvalTask, writeHiddenTests } from "./candidates";
import { bare, changeSize, confined, endedOnError, git, pinnedConfig, prepare, price, sh, type Usage } from "./replay";

/** One harness configuration: the full harness, or the full harness with one component turned off. */
export interface Arm {
	name: string;
	/** `disabledExtensions` ids, such as `extension-module:ship` or `skill:ship`. */
	disabled: string[];
}

export interface EvalRow extends Usage {
	at: string;
	task: string;
	arm: string;
	disabled: string[];
	run: number;
	model: string;
	/** Why the model could not answer, such as a usage limit; such a row is not scored. */
	error: string | null;
	passed: boolean;
	failures: string[];
	exitCode: number | null;
	minutes: number;
	filesChanged: number;
	linesChanged: number;
}

export interface ArmSummary {
	arm: string;
	runs: number;
	passRate: number;
	costPerRun: number;
	minutesPerRun: number;
	/** Against the full harness; null for the full harness itself or when it has no scored runs. */
	passRateDelta: number | null;
	costDelta: number | null;
}

const FULL = "full";
/** A Python check builds its virtual environment in the fresh clone first, which takes minutes on a cold cache. */
const CHECK_TIMEOUT_MS = 900_000;

export function arms(extensions: string[], skills: string[]): Arm[] {
	return [
		{ name: FULL, disabled: [] },
		...extensions.map(name => ({ name: `-extension:${name}`, disabled: [`extension-module:${name}`] })),
		...skills.map(name => ({ name: `-skill:${name}`, disabled: [`skill:${name}`] })),
	];
}

/** A row counts when the model answered and only the pinned model did. */
const scored = (row: EvalRow) => !row.error && Object.keys(row.answeredBy).every(model => model === bare(row.model));

/** Pass rate, cost, and minutes per arm over its scored runs, with each arm's delta against the full harness. */
export function summarize(rows: EvalRow[]): ArmSummary[] {
	const byArm = Map.groupBy(rows.filter(scored), row => row.arm);
	const plain = [...byArm].map(([arm, runs]) => ({
		arm,
		runs: runs.length,
		passRate: runs.filter(row => row.passed).length / runs.length,
		costPerRun: runs.reduce((sum, row) => sum + row.cost, 0) / runs.length,
		minutesPerRun: runs.reduce((sum, row) => sum + row.minutes, 0) / runs.length,
	}));
	const full = plain.find(summary => summary.arm === FULL);
	return plain
		.map(summary => ({
			...summary,
			passRateDelta: full && summary.arm !== FULL ? summary.passRate - full.passRate : null,
			costDelta: full && summary.arm !== FULL ? summary.costPerRun - full.costPerRun : null,
		}))
		.sort((a, b) => (a.arm === FULL ? -1 : b.arm === FULL ? 1 : a.arm.localeCompare(b.arm)));
}

/**
 * The unbiased pass@k of one task with `n` runs of which `c` passed: the chance that at least one of `k` runs drawn
 * without replacement passes, 1 - C(n-c, k) / C(n, k). Null when the task has fewer than `k` runs.
 */
export function passAtK(n: number, c: number, k: number): number | null {
	if (k < 1 || n < k) return null;
	if (n - c < k) return 1;
	let allFail = 1;
	for (let i = n - c + 1; i <= n; i++) allFail *= 1 - k / i;
	return 1 - allFail;
}

/** pass@k averaged over the tasks of `rows` that have at least `k` scored runs; null when none has. */
export function passAtKRate(rows: EvalRow[], k: number): number | null {
	const scores = [...Map.groupBy(rows.filter(scored), row => row.task).values()]
		.map(runs => passAtK(runs.length, runs.filter(row => row.passed).length, k))
		.filter(score => score !== null);
	return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

function printSummary(rows: EvalRow[]): void {
	const signed = (value: number | null, digits: number, scale = 1) => (value === null ? "" : `${value >= 0 ? "+" : ""}${(value * scale).toFixed(digits)}`);
	console.table(
		summarize(rows).map(s => ({
			arm: s.arm,
			runs: s.runs,
			"pass@1 %": (s.passRate * 100).toFixed(0),
			"pass@3 %": ((rate: number | null) => (rate === null ? "" : (rate * 100).toFixed(0)))(passAtKRate(rows.filter(row => row.arm === s.arm), 3)),
			"Δ pass pts": signed(s.passRateDelta, 0, 100),
			"$ per run": s.costPerRun.toFixed(2),
			"Δ $ per run": signed(s.costDelta, 2),
			"minutes per run": s.minutesPerRun.toFixed(1),
		})),
	);
}

const readRows = (file: string): EvalRow[] =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				.map(line => JSON.parse(line) as EvalRow)
		: [];

/** Writes the hidden tests into the clone and runs the task's check there, outside the sandbox. */
function hiddenCheck(repo: string, task: EvalTask, clone: string, dir: string): { passed: boolean; failures: string[] } {
	writeHiddenTests(repo, task, clone);
	const run = sh(task.check, clone, {}, CHECK_TIMEOUT_MS);
	writeFileSync(join(dir, "check.log"), `$ ${task.check}\n${run.output}\n${run.ok ? "passed" : "FAILED"}\n`);
	// bun test prints `(fail) name`; pytest prints `FAILED path::test - why` and `ERROR path::test`.
	const failures = [...run.output.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$|^(?:FAILED|ERROR) (\S+)/gm)].map(match => (match[1] ?? match[2])!);
	return { passed: run.ok, failures: [...new Set(failures)] };
}

interface Options {
	repo: string;
	out: string;
	model: string;
	maxCost: string;
	maxTime: string;
}

function runOnce(task: EvalTask, arm: Arm, run: number, options: Options, dryRun: boolean): EvalRow {
	const dir = join(options.out, arm.name, task.id.replace(/[^\w.-]+/g, "_"), String(run));
	rmSync(dir, { recursive: true, force: true });
	const repo = task.repo ?? options.repo;
	const clone = prepare(repo, task.base, dir);
	writeFileSync(join(dir, "prompt.md"), task.prompt);
	const sessions = join(dir, "sessions");
	const args = ["-p", "--model", options.model, "--config", pinnedConfig(options.model, dir, arm.disabled), "--session-dir", sessions, "--no-title"];
	args.push("--max-cost", options.maxCost, "--max-time", options.maxTime, task.prompt);
	const { sandboxArgs, env } = confined(repo, dir, args);
	// The kit's extensions keep their state, such as the ship trace, under XDG_CONFIG_HOME; a run writes its own.
	env.XDG_CONFIG_HOME = join(dir, "config");
	const started = Date.now();
	let exitCode: number | null = 0;
	if (dryRun) {
		console.error(`  would run in ${clone}: sandbox-exec ${sandboxArgs.slice(2, -1).join(" ")} <prompt.md>`);
		const patch = spawnSync("git", ["diff", "--binary", task.base, task.landed], { cwd: repo, maxBuffer: 1 << 28 }).stdout;
		const apply = spawnSync("git", ["apply"], { cwd: clone, input: patch, encoding: "utf8" });
		if (apply.status !== 0) throw new Error(`the landed change does not apply at the base: ${apply.stderr}`);
	} else {
		const log = openSync(join(dir, "output.txt"), "w");
		exitCode = spawnSync("sandbox-exec", sandboxArgs, { cwd: clone, env, stdio: ["ignore", log, log] }).status;
		closeSync(log);
	}
	const minutes = (Date.now() - started) / 60_000;
	const error = dryRun ? null : endedOnError(sessions);
	const { diff, filesChanged, linesChanged } = changeSize(clone, task.base);
	writeFileSync(join(dir, "change.diff"), diff);
	const { passed, failures } = error ? { passed: false, failures: [] } : hiddenCheck(repo, task, clone, dir);
	// Each clone holds its own node_modules or .venv; 60 runs of them fill a disk, and change.diff keeps what the agent did.
	rmSync(clone, { recursive: true, force: true });
	return {
		at: new Date().toISOString(),
		task: task.id,
		arm: arm.name,
		disabled: arm.disabled,
		run,
		model: dryRun ? "dry-run" : options.model,
		error,
		passed,
		failures,
		exitCode,
		minutes: Number(minutes.toFixed(1)),
		...price(sessions),
		filesChanged,
		linesChanged,
	};
}

if (import.meta.main) {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			tasks: { type: "string", default: join(import.meta.dir, "tasks.json") },
			only: { type: "string" },
			runs: { type: "string", default: "3" },
			model: { type: "string", default: "anthropic/claude-opus-5-5:auto" },
			"disable-extensions": { type: "string", default: "" },
			"disable-skills": { type: "string", default: "" },
			out: { type: "string", default: join(homedir(), ".cache", "omp-evals") },
			"max-cost": { type: "string", default: "5" },
			"max-time": { type: "string", default: "30m" },
			"dry-run": { type: "boolean", default: false },
		},
	});
	const out = resolve(values.out);
	const resultsFile = join(out, "results.jsonl");
	if (positionals[0] === "summary") {
		printSummary(readRows(resultsFile));
		process.exit(0);
	}
	mkdirSync(out, { recursive: true });
	const enclosing = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: out, encoding: "utf8" });
	if (enclosing.status === 0) throw new Error(`--out ${out} is inside the checkout ${enclosing.stdout.trim()}; a run there reads it, so pick a folder outside every checkout`);
	const repo = dirname(git(import.meta.dir, "rev-parse", "--path-format=absolute", "--git-common-dir"));
	const only = values.only ? new Set(values.only.split(",")) : null;
	const tasks = (JSON.parse(readFileSync(values.tasks, "utf8")) as EvalTask[]).filter(task => !only || only.has(task.id));
	const list = (text: string) => text.split(",").filter(Boolean);
	const options: Options = { repo, out, model: values.model, maxCost: values["max-cost"], maxTime: values["max-time"] };
	const done = new Set(readRows(resultsFile).filter(row => !row.error).map(row => `${row.arm}\t${row.task}\t${row.run}\t${row.model}`));
	const dryRows: EvalRow[] = [];
	for (const arm of arms(list(values["disable-extensions"]), list(values["disable-skills"]))) {
		for (const task of tasks) {
			for (let run = 1; run <= Number(values.runs); run++) {
				if (!values["dry-run"] && done.has(`${arm.name}\t${task.id}\t${run}\t${values.model}`)) continue;
				console.error(`${arm.name} ${task.id} run ${run}`);
				const row = runOnce(task, arm, run, options, values["dry-run"]);
				console.error(`  ${row.error ? `could not answer: ${row.error}` : row.passed ? "passed" : `failed ${row.failures.length} tests`}, $${row.cost.toFixed(2)}, ${row.minutes} min`);
				if (values["dry-run"]) dryRows.push(row);
				else appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
			}
		}
	}
	printSummary(values["dry-run"] ? dryRows : readRows(resultsFile).filter(row => row.model === values.model));
	if (values["dry-run"] && dryRows.some(row => !row.passed)) process.exit(1);
}
