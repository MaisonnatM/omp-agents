import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt, type EvalTask, exportsName, namedImports, testTerms } from "./candidates";
import { arms, type EvalRow, summarize } from "./run";

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
			{ arm: "full", runs: 2, passRate: 1, costPerRun: 3, minutesPerRun: 1, passRateDelta: null, costDelta: null },
			{ arm: "-extension:ship", runs: 2, passRate: 0.5, costPerRun: 1.5, minutesPerRun: 1, passRateDelta: -0.5, costDelta: -1.5 },
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
