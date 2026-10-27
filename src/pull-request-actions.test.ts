import { describe, expect, test } from "bun:test";
import { PULL_REQUEST_ACTIONS, pullRequestActions } from "./pull-request-actions";
import type { PullRequestSummary } from "./shared/github";

describe("pullRequestActions", () => {
	const pr = (fields: Partial<PullRequestSummary>): PullRequestSummary => ({
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
		base: "main",
		stackedOn: null,
		behind: false,
		unresolved: { count: 0, exact: true, bots: 0 },
		conversations: 0,
		updatedAt: 1,
		...fields,
	});

	test("an own open PR offers each action whose problem it has, then the thermonuclear review, in registry order", () => {
		const broken = { checks: "failing", conflicts: true, unresolved: { count: 2, exact: true, bots: 0 } } as const;
		expect(pullRequestActions(pr(broken))).toEqual(["fix-ci-and-conflicts", "fix-ci", "resolve-conflicts", "address-comments", "thermonuclear-review"]);
		expect(pullRequestActions(pr({ checks: "failing" }))).toEqual(["fix-ci", "thermonuclear-review"]);
		expect(pullRequestActions(pr({ conflicts: true }))).toEqual(["resolve-conflicts", "thermonuclear-review"]);
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

	test("thermonuclear description updates use the checked CLI tool instead of a shell overwrite", () => {
		const prompt = PULL_REQUEST_ACTIONS["thermonuclear-review"].prompt(pr({}));
		expect(prompt).toContain('pr_description({repo:"acme/webapp",pr:1,change:{kind:"read"}})');
		expect(prompt).toContain('kind:"append"');
		expect(prompt).not.toContain("gh pr edit");
	});
});
