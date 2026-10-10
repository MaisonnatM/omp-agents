import { describe, expect, test } from "bun:test";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo } from "../src/user-todos-shared";
import { pendingOf, quickOn, ticketActions, ticketStart, todoActions, todoStart } from "./quick-actions";
import { messageOf } from "./starts";

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
	createdAt: "2026-09-01T00:00:00.000Z",
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
	test("starts a new session with the issue as its subject and no todo", () => {
		expect(messageOf(ticketStart(ticket({}), "plan", "/tmp", "poteto"), 2)).toMatchObject({
			t: "start",
			reqId: 2,
			kind: "new",
			cwd: "/tmp",
			subject: { kind: "ticket", id: "ENG-7" },
			todoId: null,
			skill: "poteto",
		});
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
});

describe("quickOn", () => {
	test("a failed start on a todo belongs to that todo only, and is no longer pending", () => {
		const failed = { op: todoStart(todo({}), "work", "/tmp", null), phase: "failed", error: "no omp" } as const;
		expect(quickOn(failed, { kind: "todo", id: "t1" })).toBe(failed);
		expect(quickOn(failed, { kind: "todo", id: "t2" })).toBeNull();
		expect(quickOn(failed, { kind: "ticket", id: "t1" })).toBeNull();
		expect(pendingOf(failed, { kind: "todo", id: "t1" })).toBeNull();
		expect(pendingOf({ ...failed, phase: "starting" }, { kind: "todo", id: "t1" })).toBe("work");
	});
});

