import { describe, expect, test } from "bun:test";
import type { PullRequestDetail } from "./github";
import { primaryControl } from "./moves";

const open: Pick<PullRequestDetail, "state" | "conflicts" | "checks" | "mergeState"> = { state: "open", conflicts: false, checks: "passing", mergeState: "clean" };

describe("primaryControl", () => {
	test("finished states win over conflicts, drafts and an armed merge", () => {
		expect(primaryControl({ ...open, state: "merged", conflicts: true }, "squash", "merge")).toEqual({ kind: "merged" });
		expect(primaryControl({ ...open, state: "closed", conflicts: true }, "squash", "merge")).toEqual({ kind: "closed" });
	});
	test("conflicts win over a draft, which wins over an armed merge", () => {
		expect(primaryControl({ ...open, state: "draft", conflicts: true }, null, "squash")).toEqual({ kind: "resolve-conflicts" });
		expect(primaryControl({ ...open, state: "draft" }, null, "squash")).toEqual({ kind: "ready-for-review" });
	});
	test("an armed merge keeps its method even when no new method is offered", () => {
		expect(primaryControl(open, null, "rebase")).toEqual({ kind: "auto-merge-armed", method: "rebase" });
		expect(primaryControl(open, null, null)).toEqual({ kind: "none" });
	});
	test("a clean pull request merges now with the selected method, including one without checks", () => {
		expect(primaryControl(open, "squash", null)).toEqual({ kind: "merge", method: "squash" });
		expect(primaryControl({ ...open, checks: "none" }, "merge", null)).toEqual({ kind: "merge", method: "merge" });
	});
	test("pending checks, a stale base or a rule of the base branch queue a merge for later", () => {
		expect(primaryControl({ ...open, checks: "pending" }, "squash", null)).toEqual({ kind: "enable-auto-merge", method: "squash" });
		expect(primaryControl({ ...open, mergeState: "behind" }, "rebase", null)).toEqual({ kind: "enable-auto-merge", method: "rebase" });
		expect(primaryControl({ ...open, mergeState: "blocked" }, "merge", null)).toEqual({ kind: "enable-auto-merge", method: "merge" });
	});
});
