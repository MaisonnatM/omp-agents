import { describe, expect, test } from "bun:test";
import type { ClientMsg } from "../shared/protocol";
import { MAX_PROMPT_DOCUMENT_BYTES } from "../shared/prompt-files";
import { MAX_PROMPT_IMAGE_BYTES, newSessionRequest } from "../shared/sessions";
import type { RoutineChange, Schedule } from "../routines";
import { MAX_TICKET_ATTACHMENT_BYTES } from "../shared/tickets";
import { parseCalendarShown, parseClientMsg, parseGoogleClient, parseIntegrationId, parsePromptDocument, parsePullRequestEdit, parsePullRequestQuery, parseRepoQuery, parseSlackClient, parseTicketAttachment, parseTicketDraft, parseTicketEdit, parseWorkspaceChange } from "./wire";

const msg = (value: unknown): ClientMsg | null => parseClientMsg(JSON.stringify(value))?.ok ?? null;
const live = { kind: "live", instanceId: "i1", agentId: null };

describe("parseClientMsg", () => {
	test("rejects text that is not a JSON object", () => {
		expect(parseClientMsg("not json")).toBeNull();
		expect(parseClientMsg("[]")).toBeNull();
		expect(parseClientMsg("null")).toBeNull();
		expect(msg({ t: "no-such-message" })).toBeNull();
	});

	test("an ack rides along with any message, and one that is not a counter rejects the message", () => {
		const frame = (ack: unknown) => parseClientMsg(JSON.stringify({ t: "end", instanceId: "i1", ack }))?.ok ?? null;
		expect(frame(7)).toEqual({ t: "end", instanceId: "i1", ack: 7 });
		expect(frame(undefined)).toEqual({ t: "end", instanceId: "i1" });
		expect(frame(1.5)).toBeNull();
		expect(frame(-1)).toBeNull();
		expect(frame("7")).toBeNull();
		expect(frame(null)).toBeNull();
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
			change: { op: "add", id: "a", parentId: null, afterId: "b", categoryId: "w", text: "Ship", body: "", due: null, links: [], addedBy: null, status: "todo", priority: 0, assignee: null, createdAt: null },
		});
		const pr = { kind: "pull-request", owner: "o", repo: "r", number: 3 };
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Review", links: [pr], due: "2026-10-06", addedBy: "s1", status: "backlog", priority: 2, createdAt: "2026-10-05T09:00:00.000Z" })).toMatchObject({
			change: { links: [pr], due: "2026-10-06", addedBy: "s1", status: "backlog", priority: 2, createdAt: "2026-10-05T09:00:00.000Z" },
		});
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", links: [{ kind: "pull-request", owner: "o", repo: "r", number: 0 }] })).toBeNull();
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", due: "Friday" })).toBeNull();
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", status: "started" })).toBeNull();
		expect(change({ op: "set-status", id: "a", status: "canceled", at: "2026-10-05T09:00:00.000Z" })).toEqual({ t: "user-todo", change: { op: "set-status", id: "a", status: "canceled", at: "2026-10-05T09:00:00.000Z" } });
		expect(change({ op: "set-status", id: "a", status: "done", at: "soon" })).toBeNull();
		expect(change({ op: "set-status", id: "a", status: "closed", at: "2026-10-05T09:00:00.000Z" })).toBeNull();
		expect(change({ op: "set-priority", id: "a", priority: 4 })).toEqual({ t: "user-todo", change: { op: "set-priority", id: "a", priority: 4 } });
		expect(change({ op: "set-priority", id: "a", priority: 5 })).toBeNull();
		expect(change({ op: "set-assignee", id: "a", assignee: "agent" })).toEqual({ t: "user-todo", change: { op: "set-assignee", id: "a", assignee: "agent" } });
		expect(change({ op: "set-assignee", id: "a", assignee: null })).toEqual({ t: "user-todo", change: { op: "set-assignee", id: "a", assignee: null } });
		expect(change({ op: "set-assignee", id: "a", assignee: "robot" })).toBeNull();
		expect(change({ op: "set-assignee", id: "a" })).toBeNull();
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", assignee: "user" })).toMatchObject({ change: { assignee: "user" } });
		expect(change({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "x", assignee: "robot" })).toBeNull();
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
		expect(change({ op: "toggle", id: "a", doneAt: "2026-10-05T09:00:00.000Z" })).toBeNull();
		expect(change({ op: "indent", id: "" })).toBeNull();
		expect(change({ op: "edit", id: "a", text: "x".repeat(2001) })).toBeNull();
		expect(change({ op: "edit-body", id: "a", body: "x".repeat(100_001) })).toBeNull();
		expect(change({ op: "rename-category", id: "w", name: "  " })).toBeNull();
		expect(change({ op: "move", id: "a" })).toBeNull();
	});

	test("restore puts back a todo of the level it names, held to the limits an add is", () => {
		const change = (value: unknown) => msg({ t: "user-todo", change: value });
		const leaf = { id: "a1", text: "Child", body: "", status: "todo" as const, priority: 0 as const, assignee: null, doneAt: null, due: null, createdAt: null };
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
			task: { kind: "prompt", prompt: "Summarize", pin: false },
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

		test("save refuses a pull request task, and a blank name, workspace, or prompt, and a prompt task without its pin choice", () => {
			expect(save({ task: { kind: "pull-requests", action: "review" } })).toBeNull();
			expect(save({ task: { kind: "prompt", prompt: " ", pin: false } })).toBeNull();
			expect(save({ task: { kind: "prompt", prompt: "Summarize" } })).toBeNull();
			expect(save({ task: { kind: "prompt", prompt: "Summarize", pin: "yes" } })).toBeNull();
			expect(save({ task: { kind: "prompt", prompt: "Summarize", pin: true } })).toEqual({ t: "routine", change: { op: "save", routine: { ...routine, task: { kind: "prompt", prompt: "Summarize", pin: true } } } });
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

	test("pin takes one or more session ids to pin or unpin, and refuses an empty list, an unknown op, or a blank id", () => {
		const change = (value: unknown) => msg({ t: "pin", change: value });
		expect(change({ op: "pin", sessionIds: ["s1", "s2"], extra: 1 })).toEqual({ t: "pin", change: { op: "pin", sessionIds: ["s1", "s2"] } });
		expect(change({ op: "unpin", sessionIds: ["s1"] })).toEqual({ t: "pin", change: { op: "unpin", sessionIds: ["s1"] } });
		expect(change({ op: "pin", sessionIds: [] })).toBeNull();
		expect(change({ op: "toggle", sessionIds: ["s1"] })).toBeNull();
		expect(change({ op: "pin", sessionIds: ["s1", ""] })).toBeNull();
		expect(change({ op: "pin", sessionIds: [7] })).toBeNull();
		expect(change({ op: "pin", sessionIds: "s1" })).toBeNull();
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

	test("dequeue, promote, interrupt, and complete take counters, known queues, and in-range cursors only", () => {
		expect(msg({ t: "dequeue", reqId: 0, view: live, queue: "followUp", text: "later" })).toMatchObject({ t: "dequeue", reqId: 0, queue: "followUp" });
		expect(msg({ t: "dequeue", reqId: -1, view: live, queue: "followUp", text: "later" })).toBeNull();
		expect(msg({ t: "dequeue", reqId: 1.5, view: live, queue: "followUp", text: "later" })).toBeNull();
		expect(msg({ t: "dequeue", reqId: 1, view: live, queue: "other", text: "x" })).toBeNull();
		expect(msg({ t: "promote", view: live, text: "later" })).toMatchObject({ t: "promote", text: "later" });
		expect(msg({ t: "promote", view: { kind: "past", sessionId: "s1" }, text: "later" })).toBeNull();
		expect(msg({ t: "interrupt", reqId: 2, view: live })).toMatchObject({ t: "interrupt", reqId: 2 });
		expect(msg({ t: "interrupt", reqId: -2, view: live })).toBeNull();

		const scope = { kind: "new", cwd: "~/code" };
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: 3 })).toMatchObject({ t: "complete", cursor: 3 });
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: 4 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope, text: "/he", cursor: -1 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope, text: "x".repeat(4097), cursor: 0 })).toBeNull();
		expect(msg({ t: "complete", reqId: 1, scope: { kind: "new", cwd: "  " }, text: "", cursor: 0 })).toBeNull();
	});

	test("start parses each kind and drops what the kind does not name", () => {
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", extra: 1 })).toEqual({ t: "start", reqId: 4, ...newSessionRequest("~/code", "hi") });
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

	test("edit-prompt needs the entry it rewinds to and non-blank text", () => {
		const edit = { t: "edit-prompt" as const, instanceId: "i1", entryId: "e1", text: "again" };
		expect(msg(edit)).toEqual(edit);
		expect(msg({ ...edit, entryId: "" })).toBeNull();
		expect(msg({ ...edit, text: "  \n" })).toBeNull();
	});
});

describe("parseWorkspaceChange", () => {
	test("adds a directory by any path the server then resolves, and hides or shows one by its absolute path", () => {
		expect(parseWorkspaceChange({ op: "add", cwd: "~/code/app" })?.ok).toEqual({ op: "add", cwd: "~/code/app" });
		expect(parseWorkspaceChange({ op: "hide", cwd: "/home/user/app" })?.ok).toEqual({ op: "hide", cwd: "/home/user/app" });
		expect(parseWorkspaceChange({ op: "show", cwd: "/home/user/app" })?.ok).toEqual({ op: "show", cwd: "/home/user/app" });
	});

	test("rejects hiding or showing a relative path, an unknown op, and an empty directory", () => {
		expect(parseWorkspaceChange({ op: "hide", cwd: "~/code/app" })).toBeNull();
		expect(parseWorkspaceChange({ op: "show", cwd: "app" })).toBeNull();
		expect(parseWorkspaceChange({ op: "remove", cwd: "/home/user/app" })).toBeNull();
		expect(parseWorkspaceChange({ op: "add", cwd: "" })).toBeNull();
	});
});
describe("parsePullRequestQuery", () => {
	const query = (qs: string) => parsePullRequestQuery(new URLSearchParams(qs));

	test("names a pull request by owner, repository, and a positive number", () => {
		expect(query("owner=anthropics&repo=omp.agents&number=12")?.ok).toEqual({ owner: "anthropics", repo: "omp.agents", number: 12 });
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

describe("parsePullRequestEdit", () => {
	const pr = { owner: "anthropics", repo: "omp-agents", number: 12 };

	test("takes one label, reviewer, or state change to a pull request", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: "good first issue", on: true } })?.ok).toEqual({ ...pr, change: { field: "label", name: "good first issue", on: true } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "reviewer", login: "octo-cat", on: false } })?.ok).toEqual({ ...pr, change: { field: "reviewer", login: "octo-cat", on: false } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "state", state: "draft" } })?.ok).toEqual({ ...pr, change: { field: "state", state: "draft" } });
	});

	test("rejects a merge, an empty label, a login with a slash, a change without its direction, and no pull request", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "state", state: "merged" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: " ", on: true } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "reviewer", login: "org/team", on: true } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: "bug" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "title", title: "x" } })).toBeNull();
		expect(parsePullRequestEdit({ owner: "a", repo: "b", change: { field: "state", state: "open" } })).toBeNull();
	});
});

describe("parseRepoQuery", () => {
	test("names a repository by owner and name, each without a slash or space", () => {
		expect(parseRepoQuery(new URLSearchParams("owner=anthropics&repo=omp.agents"))?.ok).toEqual({ owner: "anthropics", repo: "omp.agents" });
		expect(parseRepoQuery(new URLSearchParams("owner=a/b&repo=c"))).toBeNull();
		expect(parseRepoQuery(new URLSearchParams("owner=a"))).toBeNull();
	});
});

describe("parseIntegrationId", () => {
	test("takes the id of an MCP integration and nothing else", () => {
		expect(parseIntegrationId({ id: "linear" })?.ok).toBe("linear");
		expect(parseIntegrationId({ id: "slack" })?.ok).toBe("slack");
		expect(parseIntegrationId({ id: "google-calendar" })?.ok).toBe("google-calendar");
		expect(parseIntegrationId({ id: "Linear" })).toBeNull();
		expect(parseIntegrationId({ id: "google" })).toBeNull();
		expect(parseIntegrationId({})).toBeNull();
		expect(parseIntegrationId("linear")).toBeNull();
		expect(parseIntegrationId(null)).toBeNull();
	});
});

describe("parseCalendarShown", () => {
	test("takes a calendar id and a boolean, and refuses an empty id or another value for shown", () => {
		expect(parseCalendarShown({ id: "team@group.calendar.google.com", shown: false })?.ok).toEqual({ id: "team@group.calendar.google.com", shown: false });
		expect(parseCalendarShown({ id: "max@example.com", shown: true, extra: 1 })?.ok).toEqual({ id: "max@example.com", shown: true });
		expect(parseCalendarShown({ id: "", shown: true })).toBeNull();
		expect(parseCalendarShown({ id: "max@example.com", shown: "false" })).toBeNull();
		expect(parseCalendarShown({ id: "max@example.com" })).toBeNull();
	});
});

describe("parseSlackClient", () => {
	test("normalizes a subset of the chat scopes and omits an empty secret", () => {
		expect(parseSlackClient({
			clientId: " 111.222 ",
			clientSecret: "  ",
			redirectUri: " https://omp.example/slack ",
			callbackPort: 8787,
			scope: "chat:write, channels:history chat:write",
		})).toEqual({ ok: { clientId: "111.222", redirectUri: "https://omp.example/slack", callbackPort: 8787, scope: "chat:write channels:history" } });
	});

	test("rejects invalid redirects, unsupported scopes, and non-integer callback ports", () => {
		const app = { clientId: "111", redirectUri: "https://omp.example/slack", callbackPort: 3000, scope: "chat:write" };
		expect(parseSlackClient({ ...app, redirectUri: "http://127.0.0.1:3000/callback" })).toHaveProperty("error");
		expect(parseSlackClient({ ...app, redirectUri: "https://[::1]:8443/callback", callbackPort: 8443 })).toHaveProperty("error");
		expect(parseSlackClient({ ...app, scope: "constructor" })).toHaveProperty("error");
		expect(parseSlackClient({ ...app, callbackPort: 3.5 })).toHaveProperty("error");
	});
});

describe("parseGoogleClient", () => {
	test("trims a Google client ID, omits an empty secret, and keeps the port", () => {
		expect(parseGoogleClient({ clientId: " 1-a.apps.googleusercontent.com ", clientSecret: " ", callbackPort: 3119 })).toEqual({ ok: { clientId: "1-a.apps.googleusercontent.com", callbackPort: 3119 } });
		expect(parseGoogleClient({ clientId: "1-a.apps.googleusercontent.com", clientSecret: " s ", callbackPort: 3119 })).toEqual({ ok: { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s", callbackPort: 3119 } });
	});

	test("rejects a client ID that is not Google's, a secret that is not a string, and a bad port", () => {
		const client = { clientId: "1-a.apps.googleusercontent.com", callbackPort: 3119 };
		expect(parseGoogleClient({ ...client, clientId: "111.222" })).toHaveProperty("error");
		expect(parseGoogleClient({ ...client, clientSecret: 7 })).toHaveProperty("error");
		expect(parseGoogleClient({ ...client, callbackPort: 0 })).toHaveProperty("error");
		expect(parseGoogleClient({ ...client, callbackPort: "3119" })).toHaveProperty("error");
	});
});

describe("parseTicketEdit", () => {
	test("keeps each field given, null clearing the ones that clear, and the labels once each", () => {
		expect(parseTicketEdit({ id: "ENG-1", state: "In Review", priority: 0, labels: ["Bug", "Front", "Bug"], dueDate: "2026-10-09", extra: true })?.ok).toEqual({
			id: "ENG-1",
			state: "In Review",
			priority: 0,
			labels: ["Bug", "Front"],
			dueDate: "2026-10-09",
		});
		expect(parseTicketEdit({ id: "ENG-1", assignee: null, project: null, dueDate: null, labels: [] })?.ok).toEqual({ id: "ENG-1", assignee: null, project: null, dueDate: null, labels: [] });
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

describe("parseTicketDraft", () => {
	test("keeps the trimmed title, the description as written, and the fields the pills set", () => {
		expect(parseTicketDraft({ title: "  Fix login ", description: "", team: "t1", state: "Todo", priority: 2, assignee: null, labels: ["Bug", "Bug"], project: "Web", dueDate: "2026-10-09" })?.ok).toEqual({
			title: "Fix login",
			description: "",
			team: "t1",
			state: "Todo",
			priority: 2,
			assignee: null,
			labels: ["Bug"],
			project: "Web",
			dueDate: "2026-10-09",
		});
	});

	test("rejects a draft without a title or team, or with a field of the wrong kind", () => {
		expect(parseTicketDraft({ title: " ", description: "", team: "t1" })).toBeNull();
		expect(parseTicketDraft({ title: "Fix", description: "", team: "" })).toBeNull();
		expect(parseTicketDraft({ title: "Fix", team: "t1" })).toBeNull();
		expect(parseTicketDraft({ title: "Fix", description: "", team: "t1", priority: 7 })).toBeNull();
		expect(parseTicketDraft({ title: "Fix", description: "", team: "t1", dueDate: "soon" })).toBeNull();
	});
});

describe("parseTicketAttachment", () => {
	const file = { issue: "ENG-1", name: "shot.png", type: "image/png", data: "aGVsbG8=" };

	test("takes a named file in base64 for an issue, an empty file included", () => {
		expect(parseTicketAttachment(file)?.ok).toEqual(file);
		expect(parseTicketAttachment({ ...file, data: "" })?.ok).toEqual({ ...file, data: "" });
	});

	test("rejects a file for no issue, without a name or type, not in base64, or over the size limit", () => {
		expect(parseTicketAttachment({ ...file, issue: "eng-1" })).toBeNull();
		expect(parseTicketAttachment({ ...file, name: "" })).toBeNull();
		expect(parseTicketAttachment({ ...file, type: "" })).toBeNull();
		expect(parseTicketAttachment({ ...file, data: "not base64!" })).toBeNull();
		expect(parseTicketAttachment({ ...file, data: "A".repeat((MAX_TICKET_ATTACHMENT_BYTES / 3) * 4 + 4) })).toBeNull();
	});
});

describe("parsePromptDocument", () => {
	test("takes a named document in base64 within the size limit, and refuses one without a name, not in base64, or larger", () => {
		const document = { name: "spec.pdf", data: "JVBERi0=" };
		expect(parsePromptDocument({ ...document, extra: 1 })?.ok).toEqual(document);
		expect(parsePromptDocument({ ...document, name: "" })).toBeNull();
		expect(parsePromptDocument({ ...document, data: "not base64!" })).toBeNull();
		expect(parsePromptDocument({ ...document, data: "A".repeat(Math.ceil(MAX_PROMPT_DOCUMENT_BYTES / 3) * 4 + 4) })).toBeNull();
	});
});
