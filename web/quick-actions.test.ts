import { describe, expect, test } from "bun:test";
import type { InboxPullRequest, Ticket } from "../src/shared";
import { pullRequestActions, ticketActions, ticketStart } from "./quick-actions";

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
		head: "me/widgets",
		stackedOn: null,
		unresolved: { count: 0, exact: true },
		updatedAt: 1,
		...fields,
	});

	test("an own open PR offers each action whose problem it has, in registry order", () => {
		const broken = { checks: "failing", conflicts: true, unresolved: { count: 2, exact: true } } as const;
		expect(pullRequestActions(pr(broken))).toEqual(["fix-ci", "resolve-conflicts", "address-comments"]);
		expect(pullRequestActions(pr({ ...broken, state: "merged" }))).toEqual([]);
	});

	test("an own PR with nothing to fix offers nothing", () => {
		expect(pullRequestActions(pr({}))).toEqual([]);
	});

	test("requested changes alone are enough to address comments", () => {
		expect(pullRequestActions(pr({ review: "changes-requested" }))).toEqual(["address-comments"]);
	});

	test("a PR to review offers only the review, whatever its checks", () => {
		expect(pullRequestActions(pr({ role: "reviewer", checks: "failing" }))).toEqual(["review"]);
	});
});

const ticket = (fields: Partial<Ticket>): Ticket => ({
	id: "ENG-7",
	title: "Show feedback",
	url: "https://linear.app/acme/issue/ENG-7/show-feedback",
	status: "Todo",
	statusType: "unstarted",
	priority: 3,
	labels: [],
	project: null,
	team: "Engineering",
	dueDate: null,
	updatedAt: "2026-10-01T00:00:00.000Z",
	branch: "eng-7-show-feedback",
	...fields,
});

describe("ticketActions", () => {
	test("an issue not started yet offers work and a plan", () => {
		for (const statusType of ["triage", "backlog", "unstarted"] as const) expect(ticketActions(ticket({ statusType }))).toEqual(["work", "plan"]);
	});

	test("a started issue offers only work, which continues it", () => {
		expect(ticketActions(ticket({ statusType: "started", status: "In Review" }))).toEqual(["work"]);
	});

	test("a completed or canceled issue offers nothing", () => {
		expect(ticketActions(ticket({ statusType: "completed" }))).toEqual([]);
		expect(ticketActions(ticket({ statusType: "canceled" }))).toEqual([]);
	});
});

describe("ticketStart", () => {
	test("work happens on Linear's branch for the issue, or on a new one when Linear names none", () => {
		expect(ticketStart(ticket({}), "work", "~", "replace").prompt).toContain("on the branch `eng-7-show-feedback`");
		const unnamed = ticketStart(ticket({ branch: "" }), "work", "~", "replace").prompt;
		expect(unnamed).toContain("on a new branch named after ENG-7");
		expect(unnamed).not.toContain("``");
	});
});
