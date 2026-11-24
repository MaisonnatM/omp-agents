/**
 * The eval runs `scripts/evals/run.ts` starts from an omp session, which that session's roster row lists among its subagents.
 * The harness runs each one as its own headless omp outside the session, so omp records no link to it; the harness writes
 * one record per run into the session's artifacts directory instead, and the server reads them back.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isRunning } from "../templates/omp/agent/extensions/github/owner-lock";
import { atomicWriteTextSync } from "./fs";
import { isObject } from "./json";
import { type AgentRow, EMPTY_QUEUE } from "./shared/sessions";
import { artifactsDir } from "./subagents";

/** The folder of a session's artifacts directory that holds one `<id>.json` record per eval run it started. */
const EVAL_RUNS = "eval-runs";

export interface EvalRun {
	/** Its id among the runs its starter recorded: the task and run number, after the arm when that is not the full harness. */
	id: string;
	task: string;
	arm: string;
	run: number;
	/** The model every role is pinned to, as `run.ts --model` named it. */
	model: string;
	/** The task prompt's first line. */
	title: string;
	/** The harness process running it; a run left unfinished by a process that is gone was stopped. */
	pid: number;
	/** The run's `--session-dir`, where its omp writes its transcript. */
	sessions: string;
	/** ms since the epoch. */
	startedAt: number;
	/** How it ended, as one line, and whether its model could not answer; `null` while it runs. */
	ended: { at: number; outcome: string; error: boolean } | null;
}

/** Record `run` for the session whose transcript is `sessionFile`, replacing that run's earlier record whole. */
export function writeEvalRun(sessionFile: string, run: EvalRun): void {
	const dir = join(artifactsDir(sessionFile), EVAL_RUNS);
	mkdirSync(dir, { recursive: true });
	atomicWriteTextSync(join(dir, `${run.id}.json`), JSON.stringify(run));
}

function parseEvalRun(value: unknown): EvalRun | null {
	if (!isObject(value)) return null;
	const { id, task, arm, run, model, title, pid, sessions, startedAt, ended } = value;
	if (typeof id !== "string" || typeof task !== "string" || typeof arm !== "string" || typeof run !== "number" || typeof model !== "string") return null;
	if (typeof title !== "string" || typeof pid !== "number" || typeof sessions !== "string" || typeof startedAt !== "number") return null;
	if (ended === null) return { id, task, arm, run, model, title, pid, sessions, startedAt, ended };
	if (!isObject(ended) || typeof ended.at !== "number" || typeof ended.outcome !== "string" || typeof ended.error !== "boolean") return null;
	return { id, task, arm, run, model, title, pid, sessions, startedAt, ended: { at: ended.at, outcome: ended.outcome, error: ended.error } };
}

/** The eval runs the session whose transcript is `sessionFile` started, oldest first; a record that does not parse is skipped. */
export async function readEvalRuns(sessionFile: string): Promise<EvalRun[]> {
	const dir = join(artifactsDir(sessionFile), EVAL_RUNS);
	const names = await readdir(dir).catch(() => []);
	const runs = await Promise.all(
		names.filter(name => name.endsWith(".json")).map(name => Bun.file(join(dir, name)).json().then(parseEvalRun, () => null)),
	);
	return runs.filter(run => run !== null).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * `run` as a row under the subagent `parentId` that started it, or the main agent: running while its harness process runs it, idle once scored, aborted
 * when it could not answer or was stopped. Its id is unique among the session's subagents, since two subagents can run the same task.
 */
export function evalRunRow(run: EvalRun, parentId: string | null, alive: (pid: number) => boolean = isRunning): AgentRow {
	const stopped = run.ended === null && !alive(run.pid);
	return {
		id: parentId === null ? run.id : `${parentId}/${run.id}`,
		kind: "eval run",
		parentId,
		status: run.ended ? (run.ended.error ? "aborted" : "idle") : stopped ? "aborted" : "running",
		activity: run.ended?.outcome ?? (stopped ? "Stopped before it finished" : run.title || null),
		model: run.model,
		startedAt: run.startedAt,
		endedAt: run.ended?.at ?? null,
		canMessage: false,
		queue: EMPTY_QUEUE,
		evalRun: true,
	};
}

/** The transcript a run's omp writes, the newest session file in its session directory `sessions`; `null` before omp wrote one. */
export function evalRunTranscript(sessions: string): string | null {
	let names: string[];
	try {
		names = readdirSync(sessions);
	} catch {
		return null;
	}
	const newest = names.filter(name => name.endsWith(".jsonl") && !name.startsWith(".")).sort().at(-1);
	return newest ? join(sessions, newest) : null;
}
