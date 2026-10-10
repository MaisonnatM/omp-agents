import { expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";
import type { TodoStatus, UserTodo, UserTodoLeaf } from "../src/user-todos-shared";
import { recordItems } from "./palette-records";

const leaf = (id: string, text: string, status: TodoStatus): UserTodoLeaf => ({
	id,
	text,
	body: "",
	status,
	priority: 0,
	assignee: null,
	doneAt: status === "done" ? "2026-10-01T09:00:00.000Z" : null,
	due: null,
	createdAt: null,
});
const todo = (fields: Partial<UserTodo>): UserTodo => ({ ...leaf("t1", "Fix login", "todo"), categoryId: null, children: [], links: [], addedBy: null, ...fields });
const ticket: Ticket = {
	id: "ENG-7",
	title: "Login page",
	url: "https://linear.app/x/issue/ENG-7",
	status: "In Review",
	statusType: "started",
	priority: 0,
	labels: [],
	project: null,
	team: "ENG",
	dueDate: null,
	createdAt: "2026-09-01T00:00:00Z",
	updatedAt: "2026-10-01T00:00:00Z",
	branch: "eng-7",
};
const pr: PullRequestSummary = {
	owner: "Acme",
	repo: "web",
	number: 4,
	title: "Ship login",
	author: { login: "max", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 0,
	deletions: 0,
	head: "fix/login",
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	updatedAt: 5,
};

test("each todo, closed ones too, ticket, and pull request opens where the dashboard shows it, and a todo under another names its parent", () => {
	const items = recordItems({
		todos: [todo({ categoryId: "work", children: [leaf("c1", "Write the test", "done")] })],
		tickets: [ticket],
		pullRequestRepos: [
			{ owner: "Acme", repo: "web", cwds: [], pullRequests: [pr] },
			{ owner: "Acme", repo: "api", cwds: [], error: "gh failed" },
		],
	});
	expect(items.map(item => [item.id, item.section, item.title, item.subtitle, item.accessories, item.actions.flat().map(action => action.run)])).toEqual([
		["todo:t1", "todos", "Fix login", undefined, [{ kind: "text", text: "Todo" }], [{ kind: "link", href: "#todo/work?open=t1" }]],
		["todo:c1", "todos", "Write the test", "Fix login", [{ kind: "text", text: "Done" }], [{ kind: "link", href: "#todo/work?open=c1" }]],
		[
			"ticket:ENG-7",
			"tickets",
			"Login page",
			"ENG-7",
			[{ kind: "text", text: "In Review" }],
			[
				{ kind: "link", href: "#tickets/ENG-7" },
				{ kind: "link", href: "https://linear.app/x/issue/ENG-7", external: true },
			],
		],
		[
			"pr:acme/web#4",
			"pullRequests",
			"Ship login",
			"Acme/web#4",
			[{ kind: "age", at: 5 }],
			[
				{ kind: "link", href: "#pull-requests/Acme/web/4" },
				{ kind: "link", href: "https://github.com/Acme/web/pull/4", external: true },
			],
		],
	]);
});
