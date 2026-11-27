import { describe, expect, test } from "bun:test";
import { rollupState } from "./github";

describe("rollupState", () => {
	const proof = (startedAt: string, conclusion: string) => ({ name: "proof", status: "COMPLETED", conclusion, startedAt, checkSuite: { workflowRun: { workflow: { name: "PR proof" } } } });
	const lint = { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-27T14:10:00Z", checkSuite: { workflowRun: { workflow: { name: "CI" } } } };

	test("a newer run of a workflow replaces the run it cancelled, which GitHub's rollup still counts as a failure", () => {
		const nodes = [proof("2026-11-27T14:14:26Z", "CANCELLED"), lint, proof("2026-11-27T14:16:27Z", "SUCCESS")];
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 3, nodes } })).toBe("passing");
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 3, nodes: nodes.toReversed() } })).toBe("passing");
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 4, nodes: [...nodes, { ...lint, name: "e2e", status: "IN_PROGRESS", conclusion: null }] } })).toBe("pending");
	});

	test("a failure in the latest run still fails, and the same job name in another workflow is its own check", () => {
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 2, nodes: [proof("2026-11-27T14:14:26Z", "SUCCESS"), proof("2026-11-27T14:16:27Z", "FAILURE")] } })).toBe("failing");
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 2, nodes: [{ ...lint, conclusion: "FAILURE", checkSuite: { workflowRun: { workflow: { name: "Docs" } } } }, lint] } })).toBe("failing");
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 2, nodes: [lint, { context: "deploy", state: "ERROR" }] } })).toBe("failing");
	});

	test("GitHub's rollup stands when the query returned only some checks or none", () => {
		expect(rollupState({ state: "FAILURE", contexts: { totalCount: 40, nodes: [lint] } })).toBe("failing");
		expect(rollupState({ state: "PENDING" })).toBe("pending");
		expect(rollupState(null)).toBe("none");
	});
});
