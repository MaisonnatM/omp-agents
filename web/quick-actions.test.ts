import { describe, expect, test } from "bun:test";
import type { UserTodo } from "../src/user-todos-shared";
import { pendingOf, quickOn, todoActions, todoStart } from "./quick-actions";
import { messageOf } from "./starts";

describe("a pull request start", () => {
	test("Review saves a review draft; the thermonuclear review does not", () => {
		const pr = { owner: "acme", repo: "app", number: 7 };
		const start = (action: "review" | "thermonuclear-review") => messageOf({ kind: "quick", cwd: "/tmp", branch: null, prompt: "x", subject: { kind: "pull-request", pr, action }, skill: null, owner: null }, 1);
		expect(start("review")).toMatchObject({ kind: "new", subject: { kind: "pull-request", pr }, todoId: null, reviewDraft: true });
		expect(start("thermonuclear-review")).toMatchObject({ kind: "new", subject: { kind: "pull-request", pr }, todoId: null, reviewDraft: false });
	});
});

const todo = (fields: Partial<UserTodo>): UserTodo => ({
	id: "t1",
	text: "Speed up the sidebar",
	body: "It lags when 200 sessions are listed.\n",
	status: "todo",
	priority: 0,
	assignee: null,
	doneAt: null,
	due: null,
	createdAt: null,
	categoryId: null,
	workspace: null,
	children: [],
	links: [],
	addedBy: null,
	...fields,
});

describe("todoActions", () => {
	test("an open todo not started yet offers work and a plan", () => {
		expect(todoActions(todo({ status: "todo" }))).toEqual(["work", "plan"]);
		expect(todoActions(todo({ status: "backlog" }))).toEqual(["work", "plan"]);
	});

	test("an in-progress todo offers only work", () => {
		expect(todoActions(todo({ status: "in-progress" }))).toEqual(["work"]);
	});

	test("a closed todo offers nothing", () => {
		expect(todoActions(todo({ status: "done", doneAt: "2026-10-01T00:00:00.000Z" }))).toEqual([]);
		expect(todoActions(todo({ status: "canceled", doneAt: "2026-10-01T00:00:00.000Z" }))).toEqual([]);
	});
});

describe("todoStart", () => {
	test("starts a new session linked to the todo, with no pull request or issue subject", () => {
		const message = messageOf(todoStart(todo({}), "work", "/tmp", null), 1);
		expect(message).toMatchObject({ t: "start", reqId: 1, kind: "new", cwd: "/tmp", subject: null, todoId: "t1", skill: null });
		const prompt = message.t === "start" && message.kind === "new" ? message.prompt : "";
		expect(prompt).toContain('Todo "Speed up the sidebar"');
		expect(prompt).toContain("It lags when 200 sessions are listed.");
	});

	test("starts in the todo's Workspace when it has one, else in the directory it is given", () => {
		expect(todoStart(todo({ workspace: "/code/app" }), "plan", "/tmp", null).cwd).toBe("/code/app");
		expect(todoStart(todo({ workspace: null }), "plan", "/tmp", null).cwd).toBe("/tmp");
	});
});

describe("quickOn", () => {
	test("a failed start on a todo belongs to that todo only, and is no longer pending", () => {
		const failed = { op: todoStart(todo({}), "work", "/tmp", null), phase: "failed", error: "no omp" } as const;
		expect(quickOn(failed, { kind: "todo", id: "t1" })).toBe(failed);
		expect(quickOn(failed, { kind: "todo", id: "t2" })).toBeNull();
		expect(quickOn(failed, { kind: "pull-request", pr: { owner: "o", repo: "r", number: 1 } })).toBeNull();
		expect(pendingOf(failed, { kind: "todo", id: "t1" })).toBeNull();
		expect(pendingOf({ ...failed, phase: "starting" }, { kind: "todo", id: "t1" })).toBe("work");
	});
});

