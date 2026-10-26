import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as proc from "./proc";
import { parseMergeStatus, readPullRequestStates } from "./pull-request-merge";

afterEach(() => mock.restore());

const PR = { owner: "o", repo: "r", number: 12 };

describe("parseMergeStatus", () => {
	test("reads GitHub's merge state, checks, and auto-merge into the queue's terms", () => {
		const answer = {
			data: {
				repository: {
					autoMergeAllowed: true,
					pullRequest: {
						id: "PR_1",
						title: "Feat",
						state: "OPEN",
						isDraft: false,
						headRefName: "feat",
						headRefOid: "abc",
						baseRefName: "main",
						mergeStateStatus: "HAS_HOOKS",
						autoMergeRequest: { enabledAt: "2026-10-19T00:00:00Z" },
						commits: { nodes: [{ commit: { parents: { nodes: [{ oid: "p1" }, { oid: "p2" }] }, statusCheckRollup: { state: "PENDING" } } }] },
					},
				},
			},
		};
		expect(parseMergeStatus(answer, PR)).toEqual({ id: "PR_1", state: "open", draft: false, branch: "feat", head: "abc", base: "main", title: "Feat", mergeState: "has-hooks", checks: "pending", parents: ["p1", "p2"], autoArmed: true, autoAllowed: true });
	});

	test("a merge state this version does not know reads as unknown, and a missing pull request throws", () => {
		const node = { id: "PR_1", title: "Feat", state: "MERGED", headRefName: "feat", headRefOid: "abc", baseRefName: "main", mergeStateStatus: "SOMETHING_NEW", autoMergeRequest: null, commits: { nodes: [] } };
		expect(parseMergeStatus({ data: { repository: { pullRequest: node } } }, PR)).toMatchObject({ state: "merged", mergeState: "unknown", checks: "none", autoArmed: false, autoAllowed: false });
		expect(() => parseMergeStatus({ data: { repository: { pullRequest: null } } }, PR)).toThrow("GitHub has no pull request o/r#12");
	});
});

test("a batched state read keeps the answered pull requests when gh exits non-zero for another's error", async () => {
	const answer = { data: { repository: { p1: { state: "MERGED", headRefName: "one", headRefOid: "a1" }, p2: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a PullRequest with the number of 2." }] };
	spyOn(proc, "runJson").mockRejectedValue(new proc.JsonCommandError("gh: Could not resolve to a PullRequest with the number of 2.", JSON.stringify(answer), answer));
	const states = await readPullRequestStates([{ owner: "batch", repo: "states", number: 1 }, { owner: "batch", repo: "states", number: 2 }]);
	expect([...states]).toEqual([["batch/states#1", { state: "merged", branch: "one", head: "a1" }]]);
});
