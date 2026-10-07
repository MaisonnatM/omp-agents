import { expect, test } from "bun:test";
import type { UserTodo } from "../src/user-todos-shared";
import { workStateOf } from "./todo-work-state";

const base: UserTodo = { id: "todo", text: "Review the change", body: "", status: "todo", priority: 0, doneAt: null, due: null, createdAt: null, categoryId: null, children: [], links: [], addedBy: null };
const linked: UserTodo = { ...base, links: [{ kind: "session", sessionId: "session" }] };
const submitted = [{ owner: "example", repo: "app", number: 42, link: "submitted" as const }];
const sessions = { hosts: [], past: [] };

test("a todo without a session is an idea; a missing linked session is unavailable", () => {
	expect(workStateOf(base, sessions)).toEqual({ kind: "idea" });
	expect(workStateOf(linked, sessions)).toEqual({ kind: "unavailable", sessionId: "session" });
});

test("a live question takes precedence over work, and active work takes precedence over a PR", () => {
	const host = { sessionId: "session", status: "working" as const, requests: [], pullRequests: submitted, ship: null };
	expect(workStateOf(linked, { hosts: [host], past: [] })).toEqual({ kind: "working", sessionId: "session" });
	expect(workStateOf(linked, { hosts: [{ ...host, status: "needs-input" }], past: [] })).toEqual({ kind: "needs-you", sessionId: "session" });
	expect(workStateOf(linked, { hosts: [{ ...host, status: "idle" }], past: [] })).toEqual({ kind: "in-review", sessionId: "session" });
});

test("ended sessions distinguish a submitted PR from an unfinished job; merged ship wins", () => {
	const past = { sessionId: "session", pullRequests: [], ship: null };
	expect(workStateOf(linked, { hosts: [], past: [past] })).toEqual({ kind: "ended", sessionId: "session" });
	expect(workStateOf(linked, { hosts: [], past: [{ ...past, pullRequests: submitted }] })).toEqual({ kind: "in-review", sessionId: "session" });
	expect(workStateOf(linked, { hosts: [], past: [{ ...past, ship: { stage: "merged" as const } }] })).toEqual({ kind: "shipped", sessionId: "session" });
});

test("a newer linked session owns state even when an older one shipped", () => {
	const todo: UserTodo = { ...linked, links: [...linked.links, { kind: "session", sessionId: "new" }] };
	expect(workStateOf(todo, { hosts: [], past: [{ sessionId: "session", pullRequests: submitted, ship: { stage: "merged" } }] })).toEqual({
		kind: "unavailable", sessionId: "new",
	});
});
