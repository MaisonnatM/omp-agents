import { describe, expect, test } from "bun:test";
import { parseMergeStatus } from "./pull-request-merge";

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
