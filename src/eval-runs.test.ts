import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvalRun, evalRunRow, evalRunTranscript, readEvalRuns, writeEvalRun } from "./eval-runs";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-eval-runs-"));
	dirs.push(dir);
	return dir;
}

const evalRun = (overrides: Partial<EvalRun> = {}): EvalRun => ({
	id: "tab-history.2",
	task: "tab-history",
	arm: "full",
	run: 2,
	model: "anthropic/claude-opus-5-5:auto",
	title: "Reopen closed tabs from history",
	pid: 4242,
	sessions: "/runs/tab-history/2/sessions",
	startedAt: 1_000,
	ended: null,
	...overrides,
});

describe("eval run records", () => {
	test("a session reads back the runs recorded in its artifacts directory, oldest first, each run's latest record only", async () => {
		const sessionFile = join(tempDir(), "2026-11-24_session.jsonl");
		writeEvalRun(sessionFile, evalRun({ id: "b.1", startedAt: 2_000 }));
		writeEvalRun(sessionFile, evalRun({ id: "a.1", startedAt: 1_000 }));
		writeEvalRun(sessionFile, evalRun({ id: "b.1", startedAt: 2_000, ended: { at: 3_000, outcome: "passed, $1.00, 2 min", error: false } }));
		const runs = await readEvalRuns(sessionFile);
		expect(runs.map(run => [run.id, run.ended?.outcome ?? null])).toEqual([
			["a.1", null],
			["b.1", "passed, $1.00, 2 min"],
		]);
	});

	test("a session that started no run, and a record that does not parse, read as nothing", async () => {
		const sessionFile = join(tempDir(), "session.jsonl");
		expect(await readEvalRuns(sessionFile)).toEqual([]);
		mkdirSync(join(sessionFile.replace(/\.jsonl$/, ""), "eval-runs"), { recursive: true });
		writeFileSync(join(sessionFile.replace(/\.jsonl$/, ""), "eval-runs", "broken.json"), "{");
		writeFileSync(join(sessionFile.replace(/\.jsonl$/, ""), "eval-runs", "partial.json"), JSON.stringify({ id: "x" }));
		expect(await readEvalRuns(sessionFile)).toEqual([]);
	});
});

describe("evalRunRow", () => {
	test("a run its harness still runs is a running subagent showing its task's title", () => {
		expect(evalRunRow(evalRun(), null, () => true)).toMatchObject({
			id: "tab-history.2",
			kind: "eval run",
			parentId: null,
			status: "running",
			activity: "Reopen closed tabs from history",
			model: "anthropic/claude-opus-5-5:auto",
			startedAt: 1_000,
			endedAt: null,
			canMessage: false,
			evalRun: true,
		});
	});

	test("a run a subagent started sits under it, with an id that tells it from the same run another starter recorded", () => {
		expect(evalRunRow(evalRun(), "Scout", () => true)).toMatchObject({ id: "Scout/tab-history.2", parentId: "Scout" });
	});

	test("a scored run is idle with its outcome, and one whose model could not answer is aborted", () => {
		const scored = evalRunRow(evalRun({ ended: { at: 5_000, outcome: "failed 3 tests, $1.01, 1.9 min", error: false } }), null, () => false);
		expect([scored.status, scored.activity, scored.endedAt]).toEqual(["idle", "failed 3 tests, $1.01, 1.9 min", 5_000]);
		const unanswered = evalRunRow(evalRun({ ended: { at: 5_000, outcome: "could not answer: usage limit", error: true } }), null, () => true);
		expect([unanswered.status, unanswered.activity]).toEqual(["aborted", "could not answer: usage limit"]);
	});

	test("an unfinished run whose harness is gone was stopped", () => {
		const row = evalRunRow(evalRun(), null, () => false);
		expect([row.status, row.activity, row.endedAt]).toEqual(["aborted", "Stopped before it finished", null]);
	});
});

describe("evalRunTranscript", () => {
	test("is the newest session file omp wrote in the run's session directory, not its lock", () => {
		const sessions = tempDir();
		expect(evalRunTranscript(sessions)).toBeNull();
		writeFileSync(join(sessions, "2026-11-24T10-15-03-020Z_a.jsonl"), "");
		writeFileSync(join(sessions, ".2026-11-24T10-22-20-305Z_b.jsonl.lock.os"), "");
		writeFileSync(join(sessions, "2026-11-24T10-22-20-305Z_b.jsonl"), "");
		expect(evalRunTranscript(sessions)).toBe(join(sessions, "2026-11-24T10-22-20-305Z_b.jsonl"));
	});

	test("is null while the run's session directory does not exist", () => {
		expect(evalRunTranscript(join(tempDir(), "missing"))).toBeNull();
	});
});
