import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CheckRun, firstPass, formatTable, type MergedPr, parseGitLog, parseMergedPrs, readSpend, report, type TraceLine } from "./harness-metrics";

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

describe("GitHub metrics", () => {
	const run = (name: string, suite: number, minute: number, conclusion: string | null): CheckRun => ({ name, suite, startedAt: `2026-11-10T10:${String(minute).padStart(2, "0")}:00Z`, conclusion });
	const prs: MergedPr[] = [
		{ number: 1, mergedAt: Date.parse("2026-11-14T12:00:00Z"), changesRequested: 1, commits: [{ sha: "a", sessions: [D] }], firstCi: [run("lint", 1, 1, "success"), run("test", 1, 0, "cancelled"), run("test", 1, 2, "skipped")] },
		{
			number: 2,
			mergedAt: Date.parse("2026-11-19T12:00:00Z"),
			changesRequested: 2,
			commits: [
				{ sha: "b", sessions: [E] },
				{ sha: "c", sessions: [] },
			],
			firstCi: [run("test", 1, 3, "success"), run("test", 1, 1, "failure")],
		},
		{ number: 3, mergedAt: Date.parse("2026-11-20T12:00:00Z"), changesRequested: 0, commits: [{ sha: "d", sessions: [E] }] },
		{ number: 4, mergedAt: Date.parse("2026-11-08T12:00:00Z"), changesRequested: 5, commits: [{ sha: "e", sessions: [] }] },
	];
	const githubTrace = [line("13T10:00:00", D, 1, "fix_comments", true, 1), line("14T10:00:00", D, 1, "merged", true), line("18T10:00:00", E, 2, "fix_comments", false, 1)];
	const periods = report({ trace: githubTrace, repos: [], spend: new Map([[E, 3]]) }, NOW, 7, 2, 7, { repo: "o/r", prs });

	test("judges a commit's checks by each check's earliest run that was not cancelled", () => {
		expect([
			firstPass([run("test", 1, 0, "cancelled")]),
			firstPass([run("test", 1, 0, "cancelled"), run("test", 1, 1, "success")]),
			firstPass([run("test", 1, 1, "failure"), run("test", 1, 2, "success")]),
			firstPass([run("test", 1, 1, "success"), run("test", 2, 1, "timed_out")]),
			firstPass([run("test", 1, 1, null)]),
			firstPass([run("test", 1, 1, "neutral"), run("deploy", 1, 1, "skipped")]),
		]).toEqual([undefined, true, false, false, false, true]);
	});

	test("prices, CI-rates, counts review rounds of, and checks for a person's commit in the PRs merged in each period", () => {
		expect(periods.map(p => p.github)).toEqual([
			{
				repo: "o/r",
				merged: 1,
				cost: { priced: 1, usd: 2, perPr: 2 },
				ciFirstPass: { judged: 1, passed: 1, rate: 1 },
				reviewRounds: { changesRequested: 1, fixRounds: 1, perPr: 2 },
				humanEdits: { edited: 0, rate: 0 },
			},
			{
				repo: "o/r",
				merged: 2,
				cost: { priced: 1, usd: 3, perPr: 3 },
				ciFirstPass: { judged: 1, passed: 0, rate: 0 },
				reviewRounds: { changesRequested: 2, fixRounds: 0, perPr: 1 },
				humanEdits: { edited: 1, rate: 0.5 },
			},
		]);
	});

	test("adds the GitHub rows to the table", () => {
		expect(formatTable(periods).split("\n").slice(7)).toEqual([
			"Merged PRs in o/r                   1                                         2",
			"Cost per merged PR                  $2.00 (1 priced)                          $3.00 (1 priced)",
			"CI first-pass rate                  100% (1/1)                                0% (0/1)",
			"Review rounds per merged PR         2.00 (1 changes requested, 1 fix rounds)  1.00 (2 changes requested, 0 fix rounds)",
			"Merged PRs with a person's commit   0% (0/1)                                  50% (1/2)",
		]);
	});

	test("reads merged PRs from gh's GraphQL search, one per line", () => {
		const node = {
			number: 7609,
			mergedAt: "2026-11-23T13:28:15Z",
			reviews: { nodes: [{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }] },
			commits: { nodes: [{ commit: { oid: "539b", message: `fix: x\n\n- body\n\nOmp-Session: ${A}\nOmp-Session: ${B}\n` } }, { commit: { oid: "77aa", message: "fix: by hand" } }] },
		};
		expect(parseMergedPrs(`${JSON.stringify(node)}\n`)).toEqual([
			{
				number: 7609,
				mergedAt: Date.parse("2026-11-23T13:28:15Z"),
				changesRequested: 1,
				commits: [
					{ sha: "539b", sessions: [A, B] },
					{ sha: "77aa", sessions: [] },
				],
			},
		]);
	});
});
