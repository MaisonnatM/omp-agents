import { expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";
import { type StarterContext, starterPrompts } from "./starters";

const ticket = (id: string, fields: Partial<Ticket> = {}): Ticket => ({
	id,
	title: `Issue ${id}`,
	url: `https://linear.app/acme/issue/${id}`,
	status: "Todo",
	statusType: "unstarted",
	priority: 3,
	labels: [],
	project: null,
	team: "Engineering",
	dueDate: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
	branch: id.toLowerCase(),
	parentId: null,
	...fields,
});

const pr = (number: number, fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
	owner: "acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	author: { login: "me", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 0,
	deletions: 0,
	head: `me/branch-${number}`,
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	updatedAt: number,
	...fields,
});

/** A Wednesday afternoon, when no time of week or day lifts a starter. */
const WEDNESDAY = new Date(2026, 10, 4, 15, 0);

const context = (fields: Partial<StarterContext> = {}): StarterContext => ({ folder: "webapp", branch: "main", tickets: [], pullRequests: [], waiting: 0, now: WEDNESDAY, ...fields });

test("every starter is listed once, with its blanks filled from the draft's directory", () => {
	const prompts = starterPrompts(context({ branch: "fix-login" }));
	expect(prompts).toHaveLength(7);
	expect(prompts).toContain("Start the dev server on fix-login and give me the URL");
	expect(prompts).toContain("Find which session made the uncommitted changes in webapp");
	expect(prompts).toContain("/ship ");
});

test("a feature branch puts the dev server first", () => {
	expect(starterPrompts(context({ branch: "fix-login" }))[0]).toBe("Start the dev server on fix-login and give me the URL");
	expect(starterPrompts(context())[0]).not.toStartWith("Start the dev server");
});

test("ship names the issue in progress before the one up next, and skips closed ones", () => {
	const tickets = [ticket("ENG-1", { statusType: "completed" }), ticket("ENG-2"), ticket("ENG-3", { statusType: "started" })];
	expect(starterPrompts(context({ tickets }))[0]).toBe("/ship ENG-3");
	expect(starterPrompts(context({ tickets: tickets.slice(0, 2) }))).toContain("/ship ENG-2");
});

test("pull requests waiting on you put shepherd first, naming your one open pull request", () => {
	const pullRequests = [pr(7), pr(8, { role: "reviewer" }), pr(9, { state: "merged" })];
	expect(starterPrompts(context({ pullRequests, waiting: 2 }))[0]).toBe("Shepherd PR acme/webapp#7 until merged: rebase, fix CI, answer review threads");
	expect(starterPrompts(context({ pullRequests: [pr(7), pr(10)], waiting: 2 }))[0]).toBe("Shepherd my open PRs until merged: rebase, fix CI, answer review threads");
});

test("Monday morning sums up last week first, a Friday evening this week", () => {
	expect(starterPrompts(context({ now: new Date(2026, 10, 2, 9, 0) }))[0]).toBe("Summarize what I merged last week across my repos");
	expect(starterPrompts(context({ now: new Date(2026, 10, 6, 17, 0) }))[0]).toBe("Summarize what I merged this week across my repos");
});

test("five issues untouched for a month put pruning above the defaults", () => {
	const tickets = ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"].map(id => ticket(id, { statusType: "backlog", updatedAt: "2026-09-01T00:00:00.000Z" }));
	expect(starterPrompts(context({ tickets }))[0]).toBe("Review my Linear todos for staleness and propose what to close");
});
