import { describe, expect, test } from "bun:test";
import { type ClientMsg, MAX_PROMPT_IMAGE_BYTES, type RoutineChange, type Schedule } from "../shared";
import { parseClientMsg, parsePullRequestQuery, parseSessionLinks, parseTicketEdit } from "./wire";

const msg = (value: unknown): ClientMsg | null => parseClientMsg(JSON.stringify(value));
const live = { kind: "live", instanceId: "i1", agentId: null };

describe("parseClientMsg", () => {
	test("rejects text that is not a JSON object", () => {
		expect(parseClientMsg("not json")).toBeNull();
		expect(parseClientMsg("[]")).toBeNull();
		expect(parseClientMsg("null")).toBeNull();
		expect(msg({ t: "no-such-message" })).toBeNull();
	});

	test("watch takes only well-formed views, and one bad view rejects the whole set", () => {
		expect(msg({ t: "watch", views: [live, { kind: "past", sessionId: "s1" }] })).toEqual({
			t: "watch",
			views: [{ kind: "live", instanceId: "i1", agentId: null }, { kind: "past", sessionId: "s1" }],
		});
		expect(msg({ t: "watch", views: [live, { kind: "live", instanceId: 7, agentId: null }] })).toBeNull();
		expect(msg({ t: "watch", views: [{ kind: "live", instanceId: "i1" }] })).toBeNull();
		expect(msg({ t: "watch", views: "all" })).toBeNull();
	});

	test("prompt needs a live view, non-blank text or images, and a known delivery", () => {
		expect(msg({ t: "prompt", view: live, text: "go", delivery: "followUp" })).toMatchObject({ t: "prompt", images: [], delivery: "followUp" });
		expect(msg({ t: "prompt", view: live, text: "  ", delivery: "steer" })).toBeNull();
		expect(msg({ t: "prompt", view: live, text: "go", delivery: "later" })).toBeNull();
		expect(msg({ t: "prompt", view: { kind: "past", sessionId: "s1" }, text: "go", delivery: "steer" })).toBeNull();
	});

	test("user-todo takes each change with the fields it needs, and drops any other field", () => {
		const change = (value: unknown) => msg({ t: "user-todo", change: value });
		expect(change({ op: "add", id: "a", parentId: null, afterId: "b", categoryId: "w", text: "Ship", extra: 1 })).toEqual({
			t: "user-todo",
			change: { op: "add", id: "a", parentId: null, afterId: "b", categoryId: "w", text: "Ship", body: "", due: null, links: [], addedBy: null },
		});
		const pr = { kind: "pull-request", owner: "o", repo: "r", number: 3 };
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Review", links: [pr], due: "2026-10-06", addedBy: "s1" })).toMatchObject({
			change: { links: [pr], due: "2026-10-06", addedBy: "s1" },
		});
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", links: [{ kind: "pull-request", owner: "o", repo: "r", number: 0 }] })).toBeNull();
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", due: "Friday" })).toBeNull();
		expect(change({ op: "toggle", id: "a", doneAt: "2026-10-05T09:00:00.000Z" })).toEqual({ t: "user-todo", change: { op: "toggle", id: "a", doneAt: "2026-10-05T09:00:00.000Z" } });
		expect(change({ op: "toggle", id: "a", doneAt: "soon" })).toBeNull();
		expect(change({ op: "move", id: "a", afterId: null, categoryId: "w" })).toEqual({ t: "user-todo", change: { op: "move", id: "a", afterId: null, categoryId: "w" } });
		expect(change({ op: "link", id: "a", link: { kind: "ticket", identifier: "ENG-1" } })).toMatchObject({ change: { link: { kind: "ticket", identifier: "ENG-1" } } });
		expect(change({ op: "link", id: "a", link: { kind: "ticket" } })).toBeNull();
		expect(change({ op: "empty-archive" })).toEqual({ t: "user-todo", change: { op: "empty-archive" } });
		expect(change({ op: "clear-done", categoryId: null })).toEqual({ t: "user-todo", change: { op: "clear-done", categoryId: null } });
		expect(change({ op: "edit-body", id: "a", body: "# Notes\n" })).toEqual({ t: "user-todo", change: { op: "edit-body", id: "a", body: "# Notes\n" } });
		expect(change({ op: "categorize", id: "a", categoryId: null })).toEqual({ t: "user-todo", change: { op: "categorize", id: "a", categoryId: null } });
		expect(change({ op: "add-category", id: "w", name: "Work" })).toEqual({ t: "user-todo", change: { op: "add-category", id: "w", name: "Work" } });
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, text: "Ship" })).toBeNull();
		expect(change({ op: "clear-done" })).toBeNull();
		expect(change({ op: "toggle", id: "a", done: "yes" })).toBeNull();
		expect(change({ op: "indent", id: "" })).toBeNull();
		expect(change({ op: "edit", id: "a", text: "x".repeat(2001) })).toBeNull();
		expect(change({ op: "edit-body", id: "a", body: "x".repeat(100_001) })).toBeNull();
		expect(change({ op: "rename-category", id: "w", name: "  " })).toBeNull();
		expect(change({ op: "move", id: "a" })).toBeNull();
	});

	test("restore puts back a todo of the level it names, held to the limits an add is", () => {
		const change = (value: unknown) => msg({ t: "user-todo", change: value });
		const leaf = { id: "a1", text: "Child", body: "", doneAt: null, due: null };
		const top = { ...leaf, id: "a", categoryId: null, children: [leaf], links: [], addedBy: null };
		expect(change({ op: "restore", parentId: null, todo: top, index: 0 })).toEqual({ t: "user-todo", change: { op: "restore", parentId: null, todo: top, index: 0 } });
		expect(change({ op: "restore", parentId: "a", todo: { ...leaf, children: [leaf] }, index: 1 })).toEqual({ t: "user-todo", change: { op: "restore", parentId: "a", todo: leaf, index: 1 } });
		expect(change({ op: "restore", parentId: null, todo: { ...top, text: "x".repeat(2001) }, index: 0 })).toBeNull();
		expect(change({ op: "restore", parentId: null, todo: { ...top, children: [{ ...leaf, body: "x".repeat(100_001) }] }, index: 0 })).toBeNull();
		expect(change({ op: "restore", parentId: null, todo: { ...top, children: [{ ...leaf, id: "c".repeat(65) }] }, index: 0 })).toBeNull();
		expect(change({ op: "restore", parentId: null, todo: top, index: -1 })).toBeNull();
	});

	describe("routine", () => {
		const change = (value: unknown) => msg({ t: "routine", change: value });
		const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };
		const routine: Extract<RoutineChange, { op: "save" }>["routine"] = {
			id: "r1",
			name: "Reviews",
			cwd: "/work/webapp",
			schedules: [weekdays],
			task: { kind: "prompt", prompt: "Summarize" },
			skill: null,
			enabled: true,
		};
		const save = (fields: Record<string, unknown>) => change({ op: "save", routine: { ...routine, ...fields } });

		test("save takes a whole routine and drops what the server keeps or does not know", () => {
			expect(save({ runs: [], createdAt: 1, extra: 1, schedules: [{ ...weekdays, extra: 1 }] })).toEqual({ t: "routine", change: { op: "save", routine } });
			expect(save({ schedules: [{ kind: "every", minutes: 90 }, weekdays], skill: "ship" })).toEqual({
				t: "routine",
				change: { op: "save", routine: { ...routine, schedules: [{ kind: "every", minutes: 90 }, weekdays], skill: "ship" } },
			});
			expect(change({ op: "enable", id: "r1", enabled: false })).toEqual({ t: "routine", change: { op: "enable", id: "r1", enabled: false } });
			expect(change({ op: "run-now", id: "r1", at: 5 })).toEqual({ t: "routine", change: { op: "run-now", id: "r1" } });
		});

		test("an older save with one schedule reads as a list of that schedule", () => {
			const { schedules: _schedules, ...older } = routine;
			expect(change({ op: "save", routine: { ...older, schedule: weekdays } })).toEqual({ t: "routine", change: { op: "save", routine } });
		});

		test("save refuses a schedule that names no slot or one out of range, and an empty list", () => {
			for (const schedule of [
				{ kind: "every", minutes: 0 },
				{ kind: "every", minutes: 1.5 },
				{ kind: "weekly", days: [], time: { hour: 9, minute: 0 } },
				{ kind: "weekly", days: [1, 1], time: { hour: 9, minute: 0 } },
				{ kind: "weekly", days: [7], time: { hour: 9, minute: 0 } },
				{ kind: "weekly", days: [1], time: { hour: 24, minute: 0 } },
				{ kind: "weekly", days: [1], time: { hour: 9, minute: 60 } },
				{ kind: "cron", expression: "0 9 * * 1-5" },
			])
				expect(save({ schedules: [schedule] })).toBeNull();
			expect(save({ schedules: [] })).toBeNull();
		});

		test("save refuses a pull request task, and a blank name, workspace, or prompt", () => {
			expect(save({ task: { kind: "pull-requests", action: "review" } })).toBeNull();
			expect(save({ task: { kind: "prompt", prompt: " " } })).toBeNull();
			expect(save({ name: "" })).toBeNull();
			expect(save({ cwd: "  " })).toBeNull();
			expect(save({ enabled: "yes" })).toBeNull();
			expect(change({ op: "enable", id: "r1" })).toBeNull();
		});

		test("save takes a command task, and refuses one blank or past the length limit", () => {
			const command = { kind: "command", command: "git worktree prune" } as const;
			expect(save({ task: command, skill: null })).toEqual({ t: "routine", change: { op: "save", routine: { ...routine, task: command, skill: null } } });
			expect(save({ task: { kind: "command", command: " \n" } })).toBeNull();
			expect(save({ task: { kind: "command" } })).toBeNull();
			const longest = { kind: "command", command: "x".repeat(10_000) };
			expect(save({ task: longest })).toMatchObject({ change: { routine: { task: longest } } });
			expect(save({ task: { kind: "command", command: "x".repeat(10_001) } })).toBeNull();
		});
	});

	test("a prompt's images must be base64 of a type models read, within the size limit", () => {
		const png = { data: "aGVsbG8=", mimeType: "image/png" };
		const prompt = (images: unknown) => msg({ t: "prompt", view: live, text: "", images, delivery: "steer" });
		expect(prompt([{ ...png, extra: 1 }])).toMatchObject({ text: "", images: [png] });
		expect(prompt([])).toBeNull();
		expect(prompt([{ ...png, mimeType: "image/svg+xml" }])).toBeNull();
		expect(prompt([{ ...png, data: "not base64!" }])).toBeNull();
		expect(prompt([{ ...png, data: "A".repeat(MAX_PROMPT_IMAGE_BYTES / 3 * 4 + 4) }])).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "", images: [png] })).toMatchObject({ prompt: "", images: [png] });
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "", images: [] })).toBeNull();
	});

	test("cancel-agent needs a live view of a subagent, not of the session", () => {
		const agent = { kind: "live", instanceId: "i1", agentId: "Worker" } as const;
		expect(msg({ t: "cancel-agent", view: agent })).toEqual({ t: "cancel-agent", view: agent });
		expect(msg({ t: "cancel-agent", view: live })).toBeNull();
		expect(msg({ t: "cancel-agent", view: { kind: "past", sessionId: "s1" } })).toBeNull();
	});

	test("dequeue and complete take counters and in-range cursors only", () => {
		const messages = [{ queue: "followUp", text: "later" }];
		expect(msg({ t: "dequeue", reqId: 0, view: live, messages })).toMatchObject({ t: "dequeue", reqId: 0 });
		expect(msg({ t: "dequeue", reqId: -1, view: live, messages })).toBeNull();
		expect(msg({ t: "dequeue", reqId: 1.5, view: live, messages })).toBeNull();
		expect(msg({ t: "dequeue", reqId: 1, view: live, messages: [{ queue: "other", text: "x" }] })).toBeNull();

		const scope = { kind: "new", cwd: "~/code" };
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: 3 })).toMatchObject({ t: "complete", cursor: 3 });
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: 4 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: -1 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope, text: "x".repeat(4097), cursor: 0 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope: { kind: "new", cwd: "  " }, text: "", cursor: 0 })).toBeNull();
	});

	test("start parses each kind and drops what the kind does not name", () => {
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", extra: 1 })).toEqual({
			t: "start",
			reqId: 4,
			kind: "new",
			cwd: "~/code",
			prompt: "hi",
			images: [],
			branch: null,
			model: null,
			thinking: null,
			skill: null,
			subject: null,
			todoId: null,
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", thinking: "high" })).toMatchObject({ thinking: "high" });
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", skill: "poteto-mode" })).toMatchObject({ skill: "poteto-mode" });
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", model: { provider: "anthropic", id: "claude-opus-5-5", name: "Opus" } })).toMatchObject({
			model: { provider: "anthropic", id: "claude-opus-5-5" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "existing", name: "fix/login", base: "main" } })).toMatchObject({
			branch: { kind: "existing", name: "fix/login" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "new", name: "feat", base: "main" } })).toMatchObject({
			branch: { kind: "new", name: "feat", base: "main" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "ticket", id: "ENG-7", action: "work" } })).toMatchObject({
			subject: { kind: "ticket", id: "ENG-7" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 12 } } })).toMatchObject({
			subject: { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 12 } },
		});
		expect(msg({ t: "start", reqId: 5, kind: "fork", view: { kind: "past", sessionId: "s1" }, entryId: "e1" })).toEqual({
			t: "start",
			reqId: 5,
			kind: "fork",
			view: { kind: "past", sessionId: "s1" },
			entryId: "e1",
		});
		expect(msg({ t: "start", reqId: 6, kind: "resume", sessionId: "s1" })).toEqual({ t: "start", reqId: 6, kind: "resume", sessionId: "s1" });
	});

	test("start rejects a missing request id, an unknown kind, and blank fields", () => {
		expect(msg({ t: "start", kind: "resume", sessionId: "s1" })).toBeNull();
		expect(msg({ t: "start", reqId: "6", kind: "resume", sessionId: "s1" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "clone", sessionId: "s1" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: " " })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "new", name: "feat" } })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "existing", name: " " } })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", branch: "main" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", model: { provider: "anthropic" } })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", model: "anthropic/claude-opus-5-5" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", thinking: "" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", skill: "" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", skill: "two words" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "ticket", id: "eng 7" } })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 0 } } })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "fork", view: live, entryId: "" })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "resume", sessionId: "" })).toBeNull();
	});

	test("answer validates each reply shape", () => {
		const answer = (value: unknown) => msg({ t: "answer", instanceId: "i1", requestId: "r1", answer: value });
		expect(answer({ kind: "value", value: "Yes" })).toMatchObject({ answer: { kind: "value", value: "Yes" } });
		expect(answer({ kind: "confirm", confirmed: false })).toMatchObject({ answer: { kind: "confirm", confirmed: false } });
		expect(answer({ kind: "cancel" })).toMatchObject({ answer: { kind: "cancel" } });
		expect(answer({ kind: "confirm", confirmed: "yes" })).toBeNull();
		expect(answer({ kind: "value" })).toBeNull();
		expect(msg({ t: "answer", instanceId: "i1", requestId: 1, answer: { kind: "cancel" } })).toBeNull();
	});

	test("set-model keeps only the provider and id, and a thinking level when it names one", () => {
		expect(msg({ t: "set-model", instanceId: "i1", model: { provider: "anthropic", id: "opus", extra: true } })).toEqual({
			t: "set-model",
			instanceId: "i1",
			model: { provider: "anthropic", id: "opus" },
			thinking: null,
		});
		expect(msg({ t: "set-model", instanceId: "i1", model: { provider: "anthropic", id: "opus" }, thinking: "high" })).toMatchObject({ thinking: "high" });
		expect(msg({ t: "set-model", instanceId: "i1", model: { provider: "anthropic", id: "opus" }, thinking: 3 })).toBeNull();
		expect(msg({ t: "set-model", instanceId: "i1", model: { provider: "anthropic" } })).toBeNull();
	});

	test("set-fast needs a boolean", () => {
		expect(msg({ t: "set-fast", instanceId: "i1", enabled: true })).toEqual({ t: "set-fast", instanceId: "i1", enabled: true });
		expect(msg({ t: "set-fast", instanceId: "i1", enabled: "true" })).toBeNull();
	});
});

describe("parsePullRequestQuery", () => {
	const query = (qs: string) => parsePullRequestQuery(new URLSearchParams(qs));

	test("names a pull request by owner, repository, and a positive number", () => {
		expect(query("owner=anthropics&repo=omp.agents&number=12")).toEqual({ owner: "anthropics", repo: "omp.agents", number: 12 });
	});

	test("rejects a missing, non-numeric, zero, or fractional number and names with a slash or space", () => {
		expect(query("owner=a&repo=b")).toBeNull();
		expect(query("owner=a&repo=b&number=x")).toBeNull();
		expect(query("owner=a&repo=b&number=0")).toBeNull();
		expect(query("owner=a&repo=b&number=1.5")).toBeNull();
		expect(query("owner=a/b&repo=c&number=1")).toBeNull();
		expect(query("owner=a&repo=b%20c&number=1")).toBeNull();
		expect(query("owner=&repo=b&number=1")).toBeNull();
	});
});

describe("parseSessionLinks", () => {
	const body = { owner: "a", repo: "b", number: 3, sessionIds: ["s1", "s2"] };

	test("returns the pull request with its session ids", () => {
		expect(parseSessionLinks(body)).toEqual(body);
	});

	test("rejects a number that is not positive, and bad names or session lists", () => {
		expect(parseSessionLinks({ ...body, number: 0 })).toBeNull();
		expect(parseSessionLinks({ ...body, number: -2 })).toBeNull();
		expect(parseSessionLinks({ ...body, number: "3" })).toBeNull();
		expect(parseSessionLinks({ ...body, owner: "a b" })).toBeNull();
		expect(parseSessionLinks({ ...body, sessionIds: [] })).toBeNull();
		expect(parseSessionLinks({ ...body, sessionIds: ["s1", 2] })).toBeNull();
		expect(parseSessionLinks("nope")).toBeNull();
	});
});

describe("parseTicketEdit", () => {
	test("keeps each field given, null clearing the ones that clear, and the labels once each", () => {
		expect(parseTicketEdit({ id: "ENG-1", state: "s-1", priority: 0, labels: ["Bug", "Front", "Bug"], dueDate: "2026-10-09", extra: true })).toEqual({
			id: "ENG-1",
			state: "s-1",
			priority: 0,
			labels: ["Bug", "Front"],
			dueDate: "2026-10-09",
		});
		expect(parseTicketEdit({ id: "ENG-1", assignee: null, project: null, dueDate: null, labels: [] })).toEqual({ id: "ENG-1", assignee: null, project: null, dueDate: null, labels: [] });
	});

	test("rejects an edit that changes nothing, names no issue, or gives a field of the wrong kind", () => {
		expect(parseTicketEdit({ id: "ENG-1" })).toBeNull();
		expect(parseTicketEdit({ id: "eng-1", priority: 1 })).toBeNull();
		expect(parseTicketEdit({ priority: 1 })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", priority: 5 })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", state: null })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", state: " " })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", labels: "Bug" })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", labels: ["Bug", 2] })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", dueDate: "next week" })).toBeNull();
		expect(parseTicketEdit({ id: "ENG-1", assignee: 3 })).toBeNull();
	});
});
