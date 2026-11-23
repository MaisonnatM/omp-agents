import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TraceLine } from "../templates/omp/agent/extensions/ship";
import { formatTable, parseGitLog, readSpend, report } from "./harness-metrics";

const NOW = Date.parse("2026-11-23T00:00:00Z");
const A = "01a20000-0000-7000-8000-00000000000a";
const B = "01a20000-0000-7000-8000-00000000000b";
const C = "01a20000-0000-7000-8000-00000000000c";
const D = "01a20000-0000-7000-8000-00000000000d";
const E = "01a20000-0000-7000-8000-00000000000e";

/** One commit as `git log --name-only` prints it with `LOG_FORMAT`. */
const logged = (sha: string, day: string, sessions: string[], subject: string, files: string[]) =>
	`\x1e${sha}\x1f${Date.parse(`2026-11-${day}T12:00:00Z`) / 1000}\x1f${sessions.join(",")}\x1f${subject}\n\n${files.join("\n")}\n`;

const gitLog = [
	logged("h4", "22", [], "Fix e.ts", ["e.ts"]),
	logged("l4", "21", [C], "Land e", ["e.ts"]),
	logged("h2", "20", [], "Add d.ts", ["d.ts"]),
	logged("l5", "19", [], "Land f", ["f.ts"]),
	logged("l3", "18", [B], "Land c", ["c.ts"]),
	logged("l2", "17", [B], "Land ab", ["a.ts", "b.ts"]),
	logged("h1", "12", [], "Fix old.ts", ["old.ts"]),
	logged("l1", "10", [A], "Land old", ["old.ts"]),
].join("");

const line = (ts: string, session: string, pr: number, stage: TraceLine["stage"], recorded: boolean, round?: number): TraceLine => ({
	ts: `2026-11-${ts}Z`,
	session,
	repo: "o/r",
	pr,
	stage,
	tokens: 100,
	cost: session === D ? 1 : 0.5,
	recorded,
	round,
});

const trace: TraceLine[] = [
	line("10T10:00:00", D, 1, "draft_pr", true),
	line("11T10:00:00", D, 1, "fix_ci", true, 1),
	line("12T10:00:00", D, 1, "fix_ci", false, 6),
	line("12T11:00:00", D, 1, "fix_ci", false, 6),
	line("13T10:00:00", D, 1, "fix_ci", true, 1),
	line("14T10:00:00", D, 1, "merged", true),
	line("17T10:00:00", E, 2, "fix_comments", false, 3),
	line("18T10:00:00", E, 2, "rebase", true),
	line("19T10:00:00", E, 2, "merged", true),
	line("20T10:00:00", E, 2, "merged", true),
	line("21T10:00:00", E, 3, "fix_ci", false, 6),
	line("22T10:00:00", E, 3, "ready_gate", false),
];

const periods = report(
	{
		trace,
		repos: [parseGitLog(gitLog)],
		spend: new Map([
			[A, 10],
			[B, 4],
			[E, 3],
		]),
	},
	NOW,
	7,
	2,
	7,
);

describe("harness metrics", () => {
	test("splits the time into back-to-back periods ending now", () => {
		expect(periods.map(p => [p.start, p.end])).toEqual([
			["2026-11-09T00:00:00.000Z", "2026-11-16T00:00:00.000Z"],
			["2026-11-16T00:00:00.000Z", "2026-11-23T00:00:00.000Z"],
		]);
	});

	test("prices landed commits and merged PRs by their sessions' spend, once per session, falling back to the trace, and leaves a trailerless Land commit unpriced", () => {
		expect(periods.map(p => p.cost)).toEqual([
			{ landings: 2, priced: 2, usd: 16, perLanding: 8 },
			{ landings: 5, priced: 3, usd: 7, perLanding: 7 / 3 },
		]);
	});

	test("rates stage calls by whether the gate recorded them", () => {
		expect(periods.map(p => p.stagePass)).toEqual([
			{ calls: 6, recorded: 4, rate: 4 / 6, byStage: { draft_pr: { calls: 1, recorded: 1 }, fix_ci: { calls: 4, recorded: 2 }, merged: { calls: 1, recorded: 1 } } },
			{
				calls: 6,
				recorded: 3,
				rate: 0.5,
				byStage: {
					fix_comments: { calls: 1, recorded: 0 },
					rebase: { calls: 1, recorded: 1 },
					merged: { calls: 2, recorded: 2 },
					fix_ci: { calls: 1, recorded: 0 },
					ready_gate: { calls: 1, recorded: 0 },
				},
			},
		]);
	});

	test("judges an escalation by the PR's next recorded stage", () => {
		expect(periods.map(p => p.escalations)).toEqual([
			{ total: 1, actedOn: 0, dismissed: 1, open: 0, accuracy: 0 },
			{ total: 2, actedOn: 1, dismissed: 0, open: 1, accuracy: 1 },
		]);
	});

	test("counts a person's first-parent commits and the landings they touched", () => {
		expect(periods.map(p => p.humanEdits)).toEqual([
			{ personCommits: 1, landings: 1, edited: 1, rate: 1, withinDays: 7 },
			{ personCommits: 2, landings: 4, edited: 1, rate: 0.25, withinDays: 7 },
		]);
	});

	test("prints one row per metric and one column per period", () => {
		expect(formatTable(periods).split("\n")).toEqual([
			"Metric                              2026-11-09..2026-11-16  2026-11-16..2026-11-23",
			"Landed changes                      2                       5",
			"Cost per landed change              $8.00 (2 priced)        $2.33 (3 priced)",
			"Stage pass rate                     67% (4/6)               50% (3/6)",
			"Escalation accuracy                 0% (0/1, 0 open)        100% (1/1, 1 open)",
			"Person commits                      1                       2",
			"Landings a person edited within 7d  100% (1/1)              25% (1/4)",
		]);
	});
});

describe("readSpend", () => {
	const root = mkdtempSync(join(tmpdir(), "harness-metrics-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("adds a session's subagents to its spend", () => {
		const file = join(root, "stats.db");
		const db = new Database(file);
		db.run("CREATE TABLE messages (session_file TEXT, cost_total REAL)");
		const insert = db.query("INSERT INTO messages VALUES (?, ?)");
		insert.run(`/s/-code-repo/2026-11-20T00-00-00-000Z_${A}.jsonl`, 2);
		insert.run(`/s/-code-repo/2026-11-20T00-00-00-000Z_${A}.jsonl`, 0.5);
		insert.run(`/s/-code-repo/2026-11-20T00-00-00-000Z_${A}/Worker.jsonl`, 1);
		insert.run(`/s/-code-repo/2026-11-21T00-00-00-000Z_${B}.jsonl`, 4);
		db.close();
		expect(readSpend(file)).toEqual(
			new Map([
				[A, 3.5],
				[B, 4],
			]),
		);
	});
});
