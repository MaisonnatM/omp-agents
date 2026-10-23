import { describe, expect, test } from "bun:test";
import type { PullRequestList, PullRequestSummary } from "../src/shared/github";
import type { AgentOn } from "../src/shared/moves";
import type { PastSession } from "../src/shared/sessions";
import type { UserTodo } from "../src/user-todos-shared";
import { boardPullRequests, boardSessions, boardTodos } from "./new-session-board-model";

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
	unresolved: { count: 0, exact: true },
	conversations: 0,
	updatedAt: number,
	...fields,
});

const list = (pullRequests: PullRequestSummary[]): PullRequestList => ({ repos: [{ owner: "acme", repo: "webapp", cwds: ["/code/webapp"], pullRequests }], unmatched: [] });

const todo = (id: string, status: UserTodo["status"]): UserTodo => ({ id, text: id, body: "", status, priority: 0, assignee: null, doneAt: null, due: null, createdAt: null, categoryId: null, children: [], links: [], addedBy: null });

const past = (sessionId: string, fields: Partial<PastSession> = {}): PastSession => ({ sessionId, title: sessionId, cwd: "/code/webapp", cwdDisplay: "~/code/webapp", source: "omp", modifiedAt: 0, interrupted: false, ...fields }) as PastSession;

describe("new session board", () => {
	test("todos leave out closed ones and group by status in the Todo page's order", () => {
		expect(boardTodos([todo("e", "backlog"), todo("a", "todo"), todo("b", "done"), todo("c", "in-progress"), todo("d", "canceled"), todo("f", "todo")]).map(t => t.id)).toEqual(["c", "a", "f", "e"]);
	});

	test("sessions are the workspace's omp ones, interrupted first, then the latest", () => {
		const sessions = [past("old", { modifiedAt: 1 }), past("new", { modifiedAt: 5 }), past("cut", { modifiedAt: 0, interrupted: true }), past("else", { cwd: "/code/api", modifiedAt: 9 }), past("claude", { source: "claude-code", modifiedAt: 9 })];
		expect(boardSessions(sessions, "/code/webapp").map(s => s.sessionId)).toEqual(["cut", "new", "old"]);
		expect(boardSessions(sessions, null).map(s => s.sessionId)).toEqual(["cut", "else", "new", "old"]);
	});

	test("pull requests are your moves an agent can take, by move rank, each with its quick action and workspace", () => {
		const noAgent: AgentOn = () => null;
		const prs = [pr(1, { checks: "failing", updatedAt: 9 }), pr(2, { role: "reviewer", author: { login: "teammate", avatarUrl: null } }), pr(3), pr(4, { state: "draft" })];
		expect(boardPullRequests(list(prs), noAgent).map(({ pr, move, action, cwd }) => [pr.number, move, action, cwd])).toEqual([
			[2, "review", "review", "/code/webapp"],
			[1, "fix-ci", "fix-ci", "/code/webapp"],
		]);
		expect(boardPullRequests(list(prs), () => "working")).toEqual([]);
		expect(boardPullRequests(null, noAgent)).toEqual([]);
	});
});
