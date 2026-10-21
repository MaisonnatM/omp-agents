import { describe, expect, test } from "bun:test";
import type { CheckRunState, PullRequestCheck } from "../src/shared/github";
import { presentChecks } from "./pull-request-checks";

const check = (state: CheckRunState, name: string = state): PullRequestCheck => ({ name, state, url: null });

describe("checks status line", () => {
	test("names an empty set without claiming it passed", () => {
		const summary = presentChecks([]);
		expect(summary.text).toBe("No checks reported");
		expect(summary.state).toBe("none");
	});

	test("only says all passed when every check passed", () => {
		expect(presentChecks([check("passing"), check("passing")]).text).toBe("All checks passed");
		expect(presentChecks([check("passing"), check("skipped")]).text).toBe("1 of 2 passing");
		expect(presentChecks([check("skipped")]).text).toBe("0 of 1 passing");
	});

	test("counts passed checks without counting skipped checks", () => {
		const checks = [...Array.from({ length: 15 }, () => check("passing")), ...Array.from({ length: 10 }, () => check("skipped"))];
		expect(presentChecks(checks).text).toBe("15 of 25 passing");
	});

	test("counts running checks against every reported check", () => {
		const summary = presentChecks([check("passing"), check("pending"), check("skipped")]);
		expect(summary.text).toBe("1 of 3 running");
		expect(summary.state).toBe("pending");
	});

	test("failures take precedence over running checks", () => {
		const summary = presentChecks([check("pending"), check("failing"), check("passing"), check("failing"), check("skipped")]);
		expect(summary.text).toBe("2 of 5 failing");
		expect(summary.state).toBe("failing");
	});
});

describe("checks popover groups", () => {
	test("partitions all states, keeping source order and duplicate names within each group", () => {
		const summary = presentChecks([
			check("skipped", "Optional"),
			check("pending", "Build"),
			{ name: "Test", state: "failing", url: "https://example.com/run/1" },
			check("passing", "Lint"),
			{ name: "Test", state: "failing", url: "https://example.com/run/2" },
			check("pending", "Deploy"),
		]);
		expect(summary.attention).toEqual([
			{ name: "Test", state: "failing", url: "https://example.com/run/1" },
			{ name: "Test", state: "failing", url: "https://example.com/run/2" },
		]);
		expect(summary.running).toEqual([
			{ name: "Build", state: "pending", url: null },
			{ name: "Deploy", state: "pending", url: null },
		]);
		expect(summary.completed).toEqual([
			{ name: "Optional", state: "skipped", url: null },
			{ name: "Lint", state: "passing", url: null },
		]);
	});
});
