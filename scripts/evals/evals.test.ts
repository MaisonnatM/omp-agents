import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, type EvalTask, exportsName, namedImports, passedTests, testTerms } from "./candidates";
import { confined } from "./replay";
import { arms, DECAY_COMPONENTS, decayPlan, decayRows, deltaBand, type EvalRow, pastCost, summarize, verdict } from "./run";

describe("hidden test imports", () => {
	test("reads named imports from relative modules, resolved against the test's folder", () => {
		const source = [
			'import { describe, test } from "bun:test";',
			'import { emptyBoard, type Board as B } from "./board";',
			'import type { Seat } from "../seats.ts";',
		].join("\n");
		expect(namedImports(source, "src/shared/board.test.ts")).toEqual(
			new Map([
				["src/shared/board", ["emptyBoard", "Board"]],
				["src/seats", ["Seat"]],
			]),
		);
	});

	test("finds a name exported by declaration or export list, and not a private one", () => {
		const source = "export function emptyBoard() {}\nconst hidden = 1;\nexport { hidden as shown, type Seat };\nexport const seed = 2;";
		expect(exportsName(source, "emptyBoard")).toBe(true);
		expect(exportsName(source, "seed")).toBe(true);
		expect(exportsName(source, "shown")).toBe(true);
		expect(exportsName(source, "Seat")).toBe(true);
		expect(exportsName(source, "hidden")).toBe(false);
		expect(exportsName("function emptyBoard() {}", "emptyBoard")).toBe(false);
	});

	test("the prompt names only the imports the base lacks", () => {
		expect(buildPrompt("Start empty\n", [])).not.toContain("import");
		expect(buildPrompt("Start empty\n", [{ module: "src/shared/board.ts", names: ["emptyBoard"] }])).toContain(
			'- import { emptyBoard } from "src/shared/board.ts"',
		);
	});

	test("reads a test's names and its quoted texts, leaving out short and interpolated ones", () => {
		const { names, texts } = testTerms('expect(call({ in_minutes: 0 })).rejects.toThrow("in_minutes must be from 1 to 10080.");\nconst id = `p${n}`; it("ok");');
		expect(names.has("in_minutes")).toBe(true);
		expect(names.has("id")).toBe(false);
		expect([...texts]).toEqual(["in_minutes must be from 1 to 10080."]);
	});

	test("the prompt lists the new names and texts word for word", () => {
		expect(buildPrompt("Stop idle sessions\n", [])).not.toContain("word for word");
		expect(buildPrompt("Stop idle sessions\n", [], ["stopIdleSessionsAfterHours", 'say "no"'])).toContain(
			'word for word:\n- "stopIdleSessionsAfterHours"\n- "say \\"no\\""',
		);
	});
});

describe("decay summary", () => {
	const row = (arm: string, passed: boolean, cost: number, extra: Partial<EvalRow> = {}): EvalRow => ({
		at: "",
		task: "t",
		arm,
		disabled: [],
		run: 1,
		model: "anthropic/claude-opus-5-5:auto",
		error: null,
		passed,
		failures: [],
		exitCode: 0,
		minutes: 1,
		cost,
		requests: 1,
		outputTokens: 1,
		answeredBy: { "anthropic/claude-opus-5-5": 1 },
		filesChanged: 1,
		linesChanged: 1,
		testsPassed: null,
		testsTotal: null,
		...extra,
	});

	test("one arm per listed component after the full harness", () => {
		expect(arms(["ship"], ["code-review"])).toEqual([
			{ name: "full", disabled: [] },
			{ name: "-extension:ship", disabled: ["extension-module:ship"] },
			{ name: "-skill:code-review", disabled: ["skill:code-review"] },
		]);
	});

	test("each component's pass rate and cost against the full harness, leaving out unanswered and unpinned runs", () => {
		const rows = [
			row("full", true, 2),
			row("full", true, 4),
			row("-extension:ship", true, 1),
			row("-extension:ship", false, 2),
			row("-extension:ship", false, 0, { error: "usage limit" }),
			row("-extension:ship", false, 9, { answeredBy: { "openai/gpt-6": 3 } }),
		];
		expect(summarize(rows)).toEqual([
			{ arm: "full", runs: 2, passRate: 1, costPerRun: 3, minutesPerRun: 1, testShare: null, passRateDelta: null, costDelta: null },
			{ arm: "-extension:ship", runs: 2, passRate: 0.5, costPerRun: 1.5, minutesPerRun: 1, testShare: null, passRateDelta: -0.5, costDelta: -1.5 },
		]);
	});

	test("the test share averages each run's passed share of its fail-to-pass tests, over the runs that have them", () => {
		const rows = [
			row("full", false, 1, { testsPassed: 64, testsTotal: 65 }),
			row("full", false, 1, { testsPassed: 1, testsTotal: 2 }),
			row("full", true, 1),
			row("-skill:ship", true, 1),
		];
		const [full, ship] = summarize(rows);
		expect(full?.testShare).toBeCloseTo((64 / 65 + 1 / 2) / 2);
		expect(ship?.testShare).toBeNull();
	});

	test("reads the passed tests from pytest's summary lines, parameters included", () => {
		const output = [
			"PASSED tests/test_a.py::test_ok",
			"PASSED tests/test_a.py::test_roles[viewer-403-refresh token]",
			"FAILED tests/test_a.py::test_no - assert 200 == 403",
			"ERROR tests/test_b.py",
			"1 failed, 2 passed, 1 error in 3.87s",
		].join("\n");
		expect([...passedTests(output)]).toEqual(["tests/test_a.py::test_ok", "tests/test_a.py::test_roles[viewer-403-refresh token]"]);
	});

	test("the noise band widens with few runs and its verdict keeps a component only when dropping it hurts beyond the band", () => {
		const hurts = deltaBand({ passes: 50, runs: 60 }, { passes: 20, runs: 60 });
		expect(hurts.high).toBeLessThan(0);
		expect(verdict(hurts)).toBe("keep");
		expect(verdict(deltaBand({ passes: 20, runs: 60 }, { passes: 50, runs: 60 }))).toBe("harmful");
		// One task's flip among 60 runs, or a full pass against a full failure on 1 run each, is noise.
		expect(verdict(deltaBand({ passes: 40, runs: 60 }, { passes: 39, runs: 60 }))).toBe("drop candidate");
		expect(verdict(deltaBand({ passes: 1, runs: 1 }, { passes: 0, runs: 1 }))).toBe("drop candidate");
	});

	test("the decay table gives each dropped component its pass@k, band, and verdict, and the full harness none", () => {
		const runs = (arm: string, task: string, passes: boolean[]) => passes.map((passed, i) => row(arm, passed, 1, { task, run: i + 1 }));
		const rows = [...Array.from({ length: 10 }, (_, t) => runs("full", `t${t}`, [true, true, true])), ...Array.from({ length: 10 }, (_, t) => runs("-skill:ship", `t${t}`, [t < 2, false, false]))].flat();
		const [full, ship] = decayRows(rows, 3);
		expect(full).toMatchObject({ arm: "full", passRate: 1, passAtK: 1, band: null, verdict: null });
		expect(ship).toMatchObject({ arm: "-skill:ship", runs: 30, passAtK: 0.2, verdict: "keep" });
		expect(ship?.passRateDelta).toBeCloseTo(-28 / 30);
	});

	test("the default decay arms drop the ship extension and each listed skill", () => {
		expect(arms(DECAY_COMPONENTS.extensions, DECAY_COMPONENTS.skills).map(arm => arm.disabled)).toEqual([[], ["extension-module:ship"], ...DECAY_COMPONENTS.skills.map(skill => [`skill:${skill}`])]);
	});

	test("the plan prices the runs still to record from the model's past runs, on the set's own tasks first", () => {
		const past = [row("full", true, 1, { task: "other" }), row("full", true, 3, { task: "t" }), row("full", true, 9, { task: "t", model: "anthropic/claude-sonnet-5-5" })];
		expect(pastCost(past, "anthropic/claude-opus-5-5:auto", new Set(["t"]))).toEqual({ perRun: 3, runs: 1, sameSet: true });
		expect(pastCost(past, "anthropic/claude-opus-5-5:auto", new Set(["new"]))).toEqual({ perRun: 2, runs: 2, sameSet: false });
		expect(pastCost(past, "openai/gpt-6", new Set(["t"]))).toBeNull();
		const plan = decayPlan({
			model: "anthropic/claude-opus-5-5:auto",
			arms: arms([], ["ship"]),
			tasks: 2,
			runs: 3,
			toRun: new Map([["full", 4], ["-skill:ship", 6]]),
			cost: { perRun: 2, runs: 2, sameSet: false },
			maxCost: 5,
		});
		expect(plan).toEqual([
			"Decay check of anthropic/claude-opus-5-5:auto: 2 arms × 2 tasks × 3 runs = 12 runs, 10 not recorded yet.",
			"  full         4 to run",
			"  -skill:ship  6 to run, disables skill:ship",
			"Estimate: 10 runs × $2.00 per run = $20.00, from 2 past scored runs of this model on other tasks.",
			"Ceiling: 10 runs × $5.00 --max-cost = $50.00.",
		]);
	});
});

test("the committed eval set has 20 tasks, each with a hidden test and a check that runs it", () => {
	const tasks = JSON.parse(readFileSync(join(import.meta.dir, "tasks.json"), "utf8")) as EvalTask[];
	expect(tasks).toHaveLength(20);
	expect(new Set(tasks.map(task => task.id)).size).toBe(20);
	for (const task of tasks) {
		expect(task.hiddenTests.length).toBeGreaterThan(0);
		expect(task.check).toBe(`bun test ${task.hiddenTests.map(path => `./${path}`).join(" ")}`);
		expect(task.base).toMatch(/^[0-9a-f]{40}$/);
		expect(task.landed).toMatch(/^[0-9a-f]{40}$/);
	}
});

test.if(process.platform === "darwin")("the sandbox lets git work in a run's clone inside a hidden folder, and still hides the run's siblings", () => {
	const out = mkdtempSync(join(tmpdir(), "evals-sandbox-"));
	try {
		const dir = join(out, "full", "pr-1", "1");
		const sibling = join(out, "full", "pr-2", "1");
		mkdirSync(join(dir, "repo"), { recursive: true });
		mkdirSync(sibling, { recursive: true });
		const { sandboxArgs } = confined(join(out, "missing-repo"), dir, [], [out]);
		const inside = (script: string) =>
			spawnSync("sandbox-exec", [...sandboxArgs.slice(0, 2), "/bin/sh", "-c", script], { cwd: join(dir, "repo"), encoding: "utf8" });
		expect(inside("git init -q . && git status --short").status).toBe(0);
		expect(inside(`ls ${sibling}`).status).not.toBe(0);
		expect(inside(`ls ${join(out, "full")}`).status).not.toBe(0);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
