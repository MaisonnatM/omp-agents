import { describe, expect, test } from "bun:test";
import type { InboxPullRequest } from "../src/shared";
import { actionsFor } from "./quick-actions";

describe("actionsFor", () => {
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
		head: "me/widgets",
		stackedOn: null,
		unresolved: { count: 0, exact: true },
		updatedAt: 1,
		...fields,
	});

	test("an own open PR offers each action whose problem it has, then the thermonuclear review, in registry order", () => {
		const broken = { checks: "failing", conflicts: true, unresolved: { count: 2, exact: true } } as const;
		expect(actionsFor(pr(broken))).toEqual(["fix-ci", "resolve-conflicts", "address-comments", "thermonuclear-review"]);
		expect(actionsFor(pr({ ...broken, state: "merged" }))).toEqual([]);
	});

	test("an own PR with nothing to fix, draft or open, offers only the thermonuclear review", () => {
		expect(actionsFor(pr({}))).toEqual(["thermonuclear-review"]);
		expect(actionsFor(pr({ state: "draft" }))).toEqual(["thermonuclear-review"]);
	});

	test("requested changes alone are enough to address comments", () => {
		expect(actionsFor(pr({ review: "changes-requested" }))).toEqual(["address-comments", "thermonuclear-review"]);
	});

	test("a PR to review offers the reviews only, whatever its checks", () => {
		expect(actionsFor(pr({ role: "reviewer", checks: "failing" }))).toEqual(["review", "thermonuclear-review"]);
	});
});
