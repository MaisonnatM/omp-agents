/**
 * Runs the eval set: each task's prompt through `omp -p` with the full harness, in a confined clone at the task's base,
 * then writes the task's hidden tests from its landed commit and records whether its check passes, with cost and minutes,
 * as one line per run in a JSONL results file.
 *
 * - `--disable-extensions a,b` and `--disable-skills c,d` add a decay check: besides the full harness, the set runs once
 *   per listed component with only that component turned off, through omp's `disabledExtensions`, and the summary prints
 *   each component's pass-rate and cost delta against the full harness, a 95% band on the pass-rate delta, and a verdict.
 *   `--decay` fills a list left out with `DECAY_COMPONENTS`, the components to recheck on a model upgrade.
 * - `--plan` prints the arms, the runs still to record, and their cost from past runs of the model, and runs nothing.
 * - A run already in the results file is skipped, so a stopped run resumes; a run whose model could not answer is
 *   recorded with its error, left out of the summary, and retried next time.
 * - `--dry-run` does everything but call the model: it prints the omp command, applies the landed change in place of
 *   the agent's, and runs the hidden check, which must pass; it records nothing.
 *
 * Usage:
 *   bun scripts/evals/run.ts [--tasks scripts/evals/tasks.json] [--only id,id] [--runs 3] [--model anthropic/claude-opus-5-5:auto]
 *     [--decay] [--disable-extensions ship,bash-guard] [--disable-skills ship] [--out ~/.cache/omp-evals] [--max-cost 5] [--max-time 30m] [--jobs 1]
 *     [--plan | --dry-run]
 *   bun scripts/evals/run.ts summary [--out ~/.cache/omp-evals] [--runs 3]
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
const DEFAULT_OUT = join(homedir(), ".cache", "omp-evals");

/**
 * The components a decay check drops one at a time by default, on a model upgrade: the ones a coding task's run loads
 * and may lean on. The thermonuclear and interface reviews are not here: only `/ship` spawns them, after it opens a pull
 * request, which a run with no remote never reaches, and omp's `disabledExtensions` has no id for an agent; dropping
 * `extension-module:ship` drops the flow that asks for them.
 */
export const DECAY_COMPONENTS = {
	extensions: ["ship"],
	skills: ["backend-development", "writing-tests", "implementation-guidelines", "diagnosing-bugs", "code-review", "ship"],
};

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

interface Tally {
	passes: number;
	runs: number;
}

/**
 * The 95% band on an arm's pass-rate change against the full harness, by the Agresti-Caffo interval: it adds one pass
 * and one failure to each side, so it stays honest at a 0% or 100% pass rate, where the plain binomial band collapses.
 */
export function deltaBand(full: Tally, arm: Tally): { low: number; high: number } {
	const smooth = ({ passes, runs }: Tally) => ({ rate: (passes + 1) / (runs + 2), runs: runs + 2 });
	const [a, b] = [smooth(full), smooth(arm)];
	const half = 1.96 * Math.sqrt((a.rate * (1 - a.rate)) / a.runs + (b.rate * (1 - b.rate)) / b.runs);
	return { low: b.rate - a.rate - half, high: b.rate - a.rate + half };
}

export type Verdict = "keep" | "drop candidate" | "harmful";

/** Removing the component lowers the pass rate beyond the band: keep it; raises it beyond the band: harmful; otherwise its effect is noise. */
export const verdict = (band: { low: number; high: number }): Verdict => (band.high < 0 ? "keep" : band.low > 0 ? "harmful" : "drop candidate");

export interface DecayRow extends ArmSummary {
	passAtK: number | null;
	/** The 95% band on `passRateDelta`; null for the full harness or when it has no scored runs. */
	band: { low: number; high: number } | null;
	verdict: Verdict | null;
}

/** Each arm's summary with its pass@k, and for each dropped component the band on its pass-rate delta and a verdict. */
export function decayRows(rows: EvalRow[], k: number): DecayRow[] {
	const summaries = summarize(rows);
	const tally = (summary: ArmSummary): Tally => ({ passes: Math.round(summary.passRate * summary.runs), runs: summary.runs });
	const full = summaries.find(summary => summary.arm === FULL);
	return summaries.map(summary => {
		const band = full && summary.arm !== FULL ? deltaBand(tally(full), tally(summary)) : null;
		return { ...summary, passAtK: passAtKRate(rows.filter(row => row.arm === summary.arm), k), band, verdict: band && verdict(band) };
	});
}

export interface PastCost {
	perRun: number;
	runs: number;
	/** Whether the runs are of the set's own tasks; otherwise they are every past scored run of the model. */
	sameSet: boolean;
}

/** The mean cost of one scored run of `model`, over the set's own tasks when it has past runs, else over every past run of the model. */
export function pastCost(rows: EvalRow[], model: string, taskIds: Set<string>): PastCost | null {
	const ofModel = rows.filter(row => row.model === model && scored(row));
	const ofSet = ofModel.filter(row => taskIds.has(row.task));
	const basis = ofSet.length > 0 ? ofSet : ofModel;
	if (basis.length === 0) return null;
	return { perRun: basis.reduce((sum, row) => sum + row.cost, 0) / basis.length, runs: basis.length, sameSet: ofSet.length > 0 };
}

/** What a run of the set would do and cost, for `--plan`: one line per arm, then the total, the estimate, and the `--max-cost` ceiling. */
export function decayPlan(plan: { model: string; arms: Arm[]; tasks: number; runs: number; toRun: Map<string, number>; cost: PastCost | null; maxCost: number }): string[] {
	const total = plan.arms.length * plan.tasks * plan.runs;
	const pending = plan.arms.reduce((sum, arm) => sum + (plan.toRun.get(arm.name) ?? 0), 0);
	const width = Math.max(...plan.arms.map(arm => arm.name.length));
	const dollars = (value: number) => `$${value.toFixed(2)}`;
	return [
		`Decay check of ${plan.model}: ${plan.arms.length} arms × ${plan.tasks} tasks × ${plan.runs} runs = ${total} runs, ${pending} not recorded yet.`,
		...plan.arms.map(arm => `  ${arm.name.padEnd(width)}  ${plan.toRun.get(arm.name) ?? 0} to run${arm.disabled.length > 0 ? `, disables ${arm.disabled.join(", ")}` : ""}`),
		plan.cost
			? `Estimate: ${pending} runs × ${dollars(plan.cost.perRun)} per run = ${dollars(pending * plan.cost.perRun)}, from ${plan.cost.runs} past scored runs of this model ${plan.cost.sameSet ? "on this set" : "on other tasks"}.`
			: `Estimate: none, no past scored run of ${plan.model}.`,
		`Ceiling: ${pending} runs × ${dollars(plan.maxCost)} --max-cost = ${dollars(pending * plan.maxCost)}.`,
	];
}

function printSummary(rows: EvalRow[], k: number): void {
	const signed = (value: number | null, digits: number, scale = 1) => (value === null ? "" : `${value >= 0 ? "+" : ""}${(value * scale).toFixed(digits)}`);
	console.table(
		decayRows(rows, k).map(s => ({
			arm: s.arm,
			runs: s.runs,
			"pass@1 %": (s.passRate * 100).toFixed(0),
			[`pass@${k} %`]: s.passAtK === null ? "" : (s.passAtK * 100).toFixed(0),
			"Δ pass pts": signed(s.passRateDelta, 0, 100),
			"95% band pts": s.band ? `${signed(s.band.low, 0, 100)} to ${signed(s.band.high, 0, 100)}` : "",
			"$ per task": s.costPerRun.toFixed(2),
			"Δ $ per task": signed(s.costDelta, 2),
			"minutes per task": s.minutesPerRun.toFixed(1),
			verdict: s.verdict ?? "",
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
	/** `mcp:<server>` ids for every MCP server the user's omp configures: a run must not post to Slack or Linear, nor wait on their startup. */
	noMcp: string[];
}

function runOnce(task: EvalTask, arm: Arm, run: number, options: Options, dryRun: boolean): EvalRow {
	const dir = join(options.out, arm.name, task.id.replace(/[^\w.-]+/g, "_"), String(run));
	rmSync(dir, { recursive: true, force: true });
	const repo = task.repo ?? options.repo;
	const clone = prepare(repo, task.base, dir);
	writeFileSync(join(dir, "prompt.md"), task.prompt);
	const sessions = join(dir, "sessions");
	const config = pinnedConfig(options.model, dir, [...arm.disabled, ...options.noMcp]);
	const args = ["-p", "--model", options.model, "--config", config, "--session-dir", sessions, "--no-title"];
	args.push("--max-cost", options.maxCost, "--max-time", options.maxTime, task.prompt);
	// Hiding every eval folder keeps a run from copying another run's change, or a dry run's landed one, from its clone.
	const { sandboxArgs, env } = confined(repo, dir, args, [options.out, DEFAULT_OUT]);
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
	// Each clone holds its own node_modules or .venv; hundreds of decay runs fill a disk, so it goes even when scoring throws.
	let filesChanged = 0;
	let linesChanged = 0;
	let check: { passed: boolean; failures: string[] } = { passed: false, failures: [] };
	try {
		const change = changeSize(clone, task.base);
		writeFileSync(join(dir, "change.diff"), change.diff);
		({ filesChanged, linesChanged } = change);
		if (!error) check = hiddenCheck(repo, task, clone, dir);
	} finally {
		rmSync(clone, { recursive: true, force: true });
	}
	const { passed, failures } = check;
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
			decay: { type: "boolean", default: false },
			"disable-extensions": { type: "string" },
			"disable-skills": { type: "string" },
			out: { type: "string", default: DEFAULT_OUT },
			"max-cost": { type: "string", default: "5" },
			"max-time": { type: "string", default: "30m" },
			"dry-run": { type: "boolean", default: false },
			plan: { type: "boolean", default: false },
			jobs: { type: "string", default: "1" },
		},
	});
	const out = resolve(values.out);
	const resultsFile = join(out, "results.jsonl");
	const runs = Number(values.runs);
	if (positionals[0] === "summary") {
		printSummary(readRows(resultsFile), runs);
		process.exit(0);
	}
	const list = (text: string | undefined, fallback: string[]) => (text !== undefined ? text.split(",").filter(Boolean) : values.decay ? fallback : []);
	const armList = arms(list(values["disable-extensions"], DECAY_COMPONENTS.extensions), list(values["disable-skills"], DECAY_COMPONENTS.skills));
	const only = values.only ? new Set(values.only.split(",")) : null;
	const tasks = (JSON.parse(readFileSync(values.tasks, "utf8")) as EvalTask[]).filter(task => !only || only.has(task.id));
	const done = new Set(readRows(resultsFile).filter(row => !row.error).map(row => `${row.arm}\t${row.task}\t${row.run}\t${row.model}`));
	if (values.plan) {
		const cache = dirname(DEFAULT_OUT);
		// The results files of every past set sit one or two folders down; a deeper walk would read every run's session files.
		const files = ["omp-evals*/results.jsonl", "omp-evals*/*/results.jsonl"].flatMap(pattern => [...new Bun.Glob(pattern).scanSync(cache)].map(file => join(cache, file)));
		const past = [...new Set([resultsFile, ...files])].flatMap(readRows);
		const toRun = new Map(armList.map(arm => [arm.name, tasks.flatMap(task => Array.from({ length: runs }, (_, i) => `${arm.name}\t${task.id}\t${i + 1}\t${values.model}`)).filter(key => !done.has(key)).length]));
		const cost = pastCost(past, values.model, new Set(tasks.map(task => task.id)));
		console.log(decayPlan({ model: values.model, arms: armList, tasks: tasks.length, runs, toRun, cost, maxCost: Number(values["max-cost"]) }).join("\n"));
		process.exit(0);
	}
	mkdirSync(out, { recursive: true });
	const enclosing = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: out, encoding: "utf8" });
	if (enclosing.status === 0) throw new Error(`--out ${out} is inside the checkout ${enclosing.stdout.trim()}; a run there reads it, so pick a folder outside every checkout`);
	const repo = dirname(git(import.meta.dir, "rev-parse", "--path-format=absolute", "--git-common-dir"));
	const mcpFile = join(homedir(), ".omp", "agent", "mcp.json");
	const mcpServers = existsSync(mcpFile) ? Object.keys((JSON.parse(readFileSync(mcpFile, "utf8")) as { mcpServers?: object }).mcpServers ?? {}) : [];
	const options: Options = {
		repo,
		out,
		model: values.model,
		maxCost: values["max-cost"],
		maxTime: values["max-time"],
		noMcp: mcpServers.map(name => `mcp:${name}`),
	};
	const jobs = Number(values.jobs);
	if (jobs > 1) {
		if (values["dry-run"]) throw new Error("--jobs runs only without --dry-run");
		// One child per task, each with --jobs 1: a task's runs stay in order, and each row is one short appended line.
		const pending = tasks.filter(task => armList.some(arm => Array.from({ length: runs }, (_, i) => `${arm.name}\t${task.id}\t${i + 1}\t${values.model}`).some(key => !done.has(key))));
		const childArgs = process.argv.slice(2).filter((arg, i, all) => arg !== "--jobs" && all[i - 1] !== "--jobs" && arg !== "--only" && all[i - 1] !== "--only" && !arg.startsWith("--jobs=") && !arg.startsWith("--only="));
		const worker = async () => {
			for (let task = pending.shift(); task; task = pending.shift()) {
				await Bun.spawn(["bun", import.meta.path, ...childArgs, "--only", task.id], { stdout: "ignore", stderr: "inherit" }).exited;
			}
		};
		await Promise.all(Array.from({ length: jobs }, worker));
		printSummary(readRows(resultsFile).filter(row => row.model === values.model), runs);
		process.exit(0);
	}
	const dryRows: EvalRow[] = [];
	for (const arm of armList) {
		for (const task of tasks) {
			for (let run = 1; run <= runs; run++) {
				if (!values["dry-run"] && done.has(`${arm.name}\t${task.id}\t${run}\t${values.model}`)) continue;
				console.error(`${arm.name} ${task.id} run ${run}`);
				const row = runOnce(task, arm, run, options, values["dry-run"]);
				console.error(`  ${row.error ? `could not answer: ${row.error}` : row.passed ? "passed" : `failed ${row.failures.length} tests`}, $${row.cost.toFixed(2)}, ${row.minutes} min`);
				if (values["dry-run"]) dryRows.push(row);
				else appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
			}
		}
	}
	printSummary(values["dry-run"] ? dryRows : readRows(resultsFile).filter(row => row.model === values.model), runs);
	if (values["dry-run"] && dryRows.some(row => !row.passed)) process.exit(1);
}
