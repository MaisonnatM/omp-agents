import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTable, readLandAttempts, readRepo, readTrace, report, type Sources, statsCost, type WindowReport } from "./metrics";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const SINCE = NOW - 30 * 86_400_000;
const A = "01a20000-0000-7000-8000-00000000000a";
const B = "01a20000-0000-7000-8000-00000000000b";
const C = "01a20000-0000-7000-8000-00000000000c";
const D = "01a20000-0000-7000-8000-00000000000d";

let root: string;
let windows: WindowReport[];

function landResult(timestamp: string, kind: string): string {
	return JSON.stringify({ type: "message", timestamp, message: { role: "toolResult", toolName: "land", content: [], details: { result: { kind } } } });
}

function git(repo: string, date: string, ...args: string[]): void {
	const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
	});
	if (done.exitCode !== 0) throw new Error(done.stderr.toString());
}

function commit(repo: string, date: string, file: string, message: string): void {
	writeFileSync(join(repo, file), `${date}\n`);
	git(repo, date, "add", file);
	git(repo, date, "commit", "--quiet", "-m", message);
}

/** Lands `files` from a branch the way `land` does: a subagent's commit without a trailer, merged on main by a commit carrying the session's. */
function agentLanding(repo: string, date: string, files: string[], session: string): void {
	git(repo, date, "checkout", "--quiet", "-b", `work-${files[0]}`);
	for (const file of files) commit(repo, date, file, `change ${file}`);
	git(repo, date, "checkout", "--quiet", "main");
	git(repo, date, "merge", "--quiet", "--no-ff", `work-${files[0]}`, "-m", `Land ${files.join(", ")}\n\nOmp-Session: ${session}`);
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "metrics-"));

	const project = join(root, "sessions", "-code-repo");
	mkdirSync(join(project, `2026-11-20T00-00-00-000Z_${A}`), { recursive: true });
	writeFileSync(
		join(project, `2026-11-20T00-00-00-000Z_${A}.jsonl`),
		[
			JSON.stringify({ type: "session", id: A }),
			landResult("2026-11-20T10:00:00Z", "failed"),
			landResult("2026-11-20T10:30:00Z", "landed"),
			JSON.stringify({ type: "message", timestamp: "2026-11-20T11:00:00Z", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: '"toolName":"land"' }] } }),
			landResult("2026-11-21T09:00:00Z", "landed"),
		].join("\n"),
	);
	writeFileSync(join(project, `2026-11-20T00-00-00-000Z_${A}`, "Worker.jsonl"), landResult("2026-11-20T10:10:00Z", "refused"));
	writeFileSync(join(project, `2026-11-01T00-00-00-000Z_${B}.jsonl`), [landResult("2026-11-01T10:00:00Z", "nothing"), landResult("2026-11-01T11:00:00Z", "landed")].join("\n"));

	const trace = (ts: string, pr: number, stage: string, recorded: boolean, round?: number, session = C) =>
		JSON.stringify({ ts, session, repo: "o/r", pr, stage, tokens: 0, cost: 0, recorded, round, refusal: recorded ? undefined : "refused" });
	writeFileSync(
		join(root, "trace.jsonl"),
		[
			trace("2026-11-19T10:00:00Z", 1, "fix_ci", true, 1),
			trace("2026-11-20T10:00:00Z", 1, "fix_ci", false, 4),
			trace("2026-11-20T10:05:00Z", 1, "fix_ci", false, 4),
			trace("2026-11-20T10:00:00Z", 1, "draft_pr", false),
			trace("2026-11-20T12:00:00Z", 1, "fix_ci", true, 1),
			trace("2026-11-22T10:00:00Z", 1, "merged", true),
			trace("2026-11-21T10:00:00Z", 2, "fix_comments", false, 3, D),
			trace("2026-11-22T11:00:00Z", 2, "merged", true, undefined, D),
			trace("2026-11-22T12:00:00Z", 3, "fix_ci", false, 4),
		].join("\n"),
	);

	const db = new Database(join(root, "stats.db"));
	db.run("CREATE TABLE messages (session_file TEXT, cost_total REAL)");
	const insert = db.query("INSERT INTO messages VALUES (?, ?)");
	insert.run(join(project, `2026-11-20T00-00-00-000Z_${A}.jsonl`), 2);
	insert.run(join(project, `2026-11-20T00-00-00-000Z_${A}`, "Worker.jsonl"), 1);
	insert.run(join(project, `2026-11-01T00-00-00-000Z_${B}.jsonl`), 4);
	insert.run(`/elsewhere/2026-11-19T00-00-00-000Z_${C}.jsonl`, 5);
	db.close();

	const repo = join(root, "repo");
	mkdirSync(repo);
	git(repo, "2026-10-01T00:00:00Z", "init", "--quiet", "-b", "main");
	commit(repo, "2026-10-01T00:00:00Z", "base.ts", "base");
	agentLanding(repo, "2026-11-05T00:00:00Z", ["old.ts"], B);
	agentLanding(repo, "2026-11-10T00:00:00Z", ["x.ts"], B);
	agentLanding(repo, "2026-11-12T00:00:00Z", ["y.ts", "x.ts"], B);
	commit(repo, "2026-11-15T00:00:00Z", "old.ts", "person edits old.ts ten days later");
	agentLanding(repo, "2026-11-20T00:00:00Z", ["a.ts"], A);
	commit(repo, "2026-11-21T00:00:00Z", "a.ts", "person edits a.ts the next day");
	agentLanding(repo, "2026-11-22T00:00:00Z", ["b.ts"], A);
	commit(repo, "2026-11-22T12:00:00Z", "c.ts", "person edits another file");

	const sources: Sources = {
		attempts: readLandAttempts(join(root, "sessions"), SINCE),
		trace: readTrace(join(root, "trace.jsonl")),
		repos: [readRepo(repo, "main", SINCE)],
		costOf: statsCost(join(root, "stats.db")),
	};
	windows = report(sources, NOW, [7, 30], 7);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("metrics", () => {
	test("prices landed changes by their sessions' spend, subagents included, once per session", () => {
		expect(windows.map(w => w.cost)).toEqual([
			{ landings: 4, priced: 3, usd: 8, perLanding: 8 / 3 },
			{ landings: 5, priced: 4, usd: 12, perLanding: 3 },
		]);
	});

	test("counts a run of land calls as passing only when its first call landed", () => {
		expect(windows.map(w => w.landPass)).toEqual([
			{ runs: 2, firstTry: 1, rate: 0.5 },
			{ runs: 3, firstTry: 2, rate: 2 / 3 },
		]);
	});

	test("judges each fix escalation by whether the agent finished the PR after more rounds", () => {
		expect(windows[0]?.escalations).toEqual({ total: 3, needed: 1, agentFinished: 1, unresolved: 1, accuracy: 0.5 });
	});

	test("finds agent landings a person edited within the window after them", () => {
		expect(windows.map(w => w.humanEdits)).toEqual([
			{ landings: 2, edited: 1, rate: 0.5, withinDays: 7 },
			{ landings: 5, edited: 1, rate: 0.2, withinDays: 7 },
		]);
	});

	test("prints one row per metric and one column per window", () => {
		expect(formatTable(windows).split("\n").map(line => line.split(/ {2,}/))).toEqual([
			["Metric", "Last 7 days", "Last 30 days"],
			["Landed changes", "4", "5"],
			["Cost per landed change", "$2.67 (3 priced)", "$3.00 (4 priced)"],
			["Land first-try pass rate", "50% (1/2)", "67% (2/3)"],
			["Escalation accuracy", "50% (1/2, 1 open)", "50% (1/2, 1 open)"],
			["Landings a person edited within 7d", "50% (1/2)", "20% (1/5)"],
		]);
	});
});
