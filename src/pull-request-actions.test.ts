import { describe, expect, test } from "bun:test";
import { pullRequestActions } from "./pull-request-actions";
import type { InboxPullRequest } from "./shared/github";

describe("pullRequestActions", () => {
	const pr = (fields: Partial<InboxPullRequest>): InboxPullRequest => ({
		owner: "acme",
		repo: "webapp",
		number: 1,
		title: "Add widgets",
		author: { login: "me", avatarUrl: null },
		reviewers: [],
		role: "author",
		state: "open",
		review: "review-required",
		checks: "passing",
		conflicts: false,
		additions: 0,
		deletions: 0,
		head: "me/widgets",
		stackedOn: null,
		unresolved: { count: 0, exact: true },
		updatedAt: 1,
		...fields,
	});

	test("an own open PR offers each action whose problem it has, then the thermonuclear review, in registry order", () => {
		const broken = { checks: "failing", conflicts: true, unresolved: { count: 2, exact: true } } as const;
		expect(pullRequestActions(pr(broken))).toEqual(["fix-ci", "resolve-conflicts", "address-comments", "thermonuclear-review"]);
		expect(pullRequestActions(pr({ ...broken, state: "merged" }))).toEqual([]);
	});

	test("an own PR with nothing to fix, draft or open, offers only the thermonuclear review", () => {
		expect(pullRequestActions(pr({}))).toEqual(["thermonuclear-review"]);
		expect(pullRequestActions(pr({ state: "draft" }))).toEqual(["thermonuclear-review"]);
	});

	test("requested changes alone are enough to address comments", () => {
		expect(pullRequestActions(pr({ review: "changes-requested" }))).toEqual(["address-comments", "thermonuclear-review"]);
	});

	test("a PR to review offers the reviews only, whatever its checks", () => {
		expect(pullRequestActions(pr({ role: "reviewer", checks: "failing" }))).toEqual(["review", "thermonuclear-review"]);
	});
});
