import { expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo, UserTodoLeaf } from "../src/user-todos-shared";
import { recordItems } from "./palette-records";

const leaf = { id: "c1", text: "Write the test", status: "in-progress" } as UserTodoLeaf;
const todo = { id: "t1", text: "Fix login", status: "todo", categoryId: "work", children: [leaf] } as unknown as UserTodo;
const ticket = { id: "ENG-7", title: "Login page", url: "https://linear.app/x/issue/ENG-7", status: "In Review" } as Ticket;
const pr = { owner: "acme", repo: "web", number: 4, title: "Ship login", head: "fix/login", author: { login: "max" }, updatedAt: 5 } as PullRequestSummary;

test("each todo, ticket, and pull request opens where the dashboard shows it, and a todo under another names its parent", () => {
	const items = recordItems({ todos: [todo], tickets: [ticket], pullRequestRepos: [{ owner: "acme", repo: "web", cwds: [], pullRequests: [pr] }, { owner: "acme", repo: "api", cwds: [], error: "gh failed" }] });
	expect(items.map(item => [item.id, item.section, item.title, item.subtitle, item.actions.flat().map(action => action.run)])).toEqual([
		["todo:t1", "todos", "Fix login", undefined, [{ kind: "link", href: "#todo/work?open=t1" }]],
		["todo:c1", "todos", "Write the test", "Fix login", [{ kind: "link", href: "#todo/work?open=c1" }]],
		[
			"ticket:ENG-7",
			"tickets",
			"Login page",
			"ENG-7",
			[
				{ kind: "link", href: "#tickets/ENG-7" },
				{ kind: "link", href: "https://linear.app/x/issue/ENG-7", external: true },
			],
		],
		[
			"pr:acme/web#4",
			"pullRequests",
			"Ship login",
			"acme/web#4",
			[
				{ kind: "link", href: "#pull-requests/acme/web/4" },
				{ kind: "link", href: "https://github.com/acme/web/pull/4", external: true },
			],
		],
	]);
	expect(items.map(item => item.accessories)).toEqual([[{ kind: "text", text: "Todo" }], [{ kind: "text", text: "In Progress" }], [{ kind: "text", text: "In Review" }], [{ kind: "age", at: 5 }]]);
});
