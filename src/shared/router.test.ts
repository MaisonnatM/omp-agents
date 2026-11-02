import { expect, test } from "bun:test";
import type { BotId } from "./bots";
import { followKey, parseRouterRequest, parseRouterTask, parseRouterTaskChange, parseRouterTasks, parseTaskFollow, type RouterTask, taskGroups, uniqueFollows } from "./router";

const atlas = "atlas" as BotId;

const task = (fields: Partial<RouterTask> = {}): RouterTask => ({
	id: "t1",
	botId: atlas,
	sessionId: "s1",
	title: "Fix the flaky test",
	cwd: "/work/webapp",
	prompt: "Find and fix it.",
	follows: [],
	status: "working",
	quiet: false,
	startedAt: 1,
	updatedAt: 1,
	restarts: 0,
	note: null,
	...fields,
});

test("a follow names a pull request, a Slack thread, or a Linear issue, and its key matches the same thing however it is cased", () => {
	expect(parseTaskFollow({ kind: "pull-request", owner: "acme", repo: "webapp", number: 7 })).toEqual({ kind: "pull-request", owner: "acme", repo: "webapp", number: 7 });
	expect(parseTaskFollow({ kind: "slack-thread", channel: "C123", ts: "1714.000100" })).toEqual({ kind: "slack-thread", channel: "C123", ts: "1714.000100" });
	expect(parseTaskFollow({ kind: "linear", id: "ENG-12" })).toEqual({ kind: "linear", id: "ENG-12" });
	expect(parseTaskFollow({ kind: "pull-request", owner: "acme", repo: "webapp", number: 0 })).toBeNull();
	expect(parseTaskFollow({ kind: "slack-thread", channel: "../x", ts: "1" })).toBeNull();
	expect(parseTaskFollow({ kind: "email", id: "x" })).toBeNull();
	expect(followKey({ kind: "pull-request", owner: "Acme", repo: "WebApp", number: 7 })).toBe(followKey({ kind: "pull-request", owner: "acme", repo: "webapp", number: 7 }));
	expect(followKey({ kind: "linear", id: "ENG-12" })).toBe(followKey({ kind: "linear", id: "eng-12" }));
	expect(followKey({ kind: "linear", id: "ENG-12" })).not.toBe(followKey({ kind: "linear", id: "ENG-13" }));
	expect(uniqueFollows([{ kind: "linear", id: "ENG-12" }, { kind: "linear", id: "eng-12" }, { kind: "slack-thread", channel: "C1", ts: "1.2" }])).toEqual([{ kind: "linear", id: "ENG-12" }, { kind: "slack-thread", channel: "C1", ts: "1.2" }]);
});

test("the tasks file keeps the tasks that parse and drops the rest", () => {
	expect(parseRouterTask(task())).toEqual(task());
	expect(parseRouterTasks({ tasks: [task(), { ...task({ id: "t2" }), status: "lost" }, task({ id: "t3", sessionId: null, follows: [{ kind: "linear", id: "ENG-1" }] })] })).toEqual([task(), task({ id: "t3", sessionId: null, follows: [{ kind: "linear", id: "ENG-1" }] })]);
	expect(parseRouterTasks([task()])).toBeNull();
	expect(parseRouterTask({ ...task(), cwd: "work" })).toBeNull();
	expect(parseRouterTask({ ...task(), id: "../x" })).toBeNull();
});

test("a Router's request starts, follows, or finishes a task, and anything else is no request", () => {
	const start = { id: "t1", title: " Fix it ", prompt: "Fix the test.", cwd: "/work", follows: [{ kind: "linear", id: "ENG-1" }], quiet: false };
	expect(parseRouterRequest({ botId: atlas, change: { op: "start", task: start } })).toEqual({ ok: { botId: atlas, change: { op: "start", task: { ...start, title: "Fix it", follows: [{ kind: "linear", id: "ENG-1" }] } } } });
	expect(parseRouterRequest({ botId: atlas, change: { op: "start", task: { ...start, cwd: "work" } } })).toBeNull();
	expect(parseRouterRequest({ botId: atlas, change: { op: "start", task: { ...start, prompt: " " } } })).toBeNull();
	expect(parseRouterRequest({ botId: atlas, change: { op: "follow", taskId: "t1", follows: [{ kind: "linear", id: "ENG-2" }] } })).toEqual({ ok: { botId: atlas, change: { op: "follow", taskId: "t1", follows: [{ kind: "linear", id: "ENG-2" }] } } });
	expect(parseRouterRequest({ botId: atlas, change: { op: "follow", taskId: "t1", follows: [] } })).toBeNull();
	expect(parseRouterRequest({ botId: atlas, change: { op: "finish", taskId: "t1", status: "done" } })).toEqual({ ok: { botId: atlas, change: { op: "finish", taskId: "t1", status: "done", note: null } } });
	expect(parseRouterRequest({ botId: atlas, change: { op: "finish", taskId: "t1", status: "working" } })).toBeNull();
	expect(parseRouterRequest({ botId: atlas, change: { op: "delete", taskId: "t1" } })).toBeNull();
	expect(parseRouterRequest({ change: { op: "finish", taskId: "t1", status: "done" } })).toBeNull();
});

test("the page marks a task done or stops it, and nothing else", () => {
	expect(parseRouterTaskChange({ op: "finish", id: "t1", status: "stopped" })).toEqual({ op: "finish", id: "t1", status: "stopped" });
	expect(parseRouterTaskChange({ op: "finish", id: "t1", status: "review" })).toBeNull();
	expect(parseRouterTaskChange({ op: "start", id: "t1" })).toBeNull();
});

test("the Tasks tab puts the tasks waiting on you first, then the ones at work, then the ones over, newest first in each", () => {
	const groups = taskGroups([
		task({ id: "old-review", status: "review", updatedAt: 1 }),
		task({ id: "working", status: "working", updatedAt: 5 }),
		task({ id: "new-review", status: "review", updatedAt: 9 }),
		task({ id: "done", status: "done", updatedAt: 3 }),
		task({ id: "stopped", status: "stopped", updatedAt: 4 }),
	]);
	expect({ review: groups.review.map(({ id }) => id), working: groups.working.map(({ id }) => id), done: groups.done.map(({ id }) => id) }).toEqual({
		review: ["new-review", "old-review"],
		working: ["working"],
		done: ["stopped", "done"],
	});
});
