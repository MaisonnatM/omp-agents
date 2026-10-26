import { describe, expect, test } from "bun:test";
import type { ClientFrame } from "../shared/protocol";
import { MAX_PROMPT_DOCUMENT_BYTES } from "../shared/prompt-files";
import { MAX_PROMPT_IMAGE_BYTES, newSessionRequest } from "../shared/sessions";
import type { RoutineSpec, Schedule } from "../routines";
import { MAX_DISCUSSION_QUOTE, MAX_DISCUSSION_SOURCE, MAX_DISCUSSION_TURNS } from "../shared/discussions";
import { MAX_SCHEDULED_TEXT } from "../shared/scheduled";
import { MAX_TICKET_ATTACHMENT_BYTES } from "../shared/tickets";
import { MAX_PULL_REQUEST_ATTACHMENTS, MAX_PULL_REQUEST_IMAGE_BYTES } from "../shared/github";
import type { ReviewDraftEdit } from "../shared/review-drafts";
import { MAX_QUEUED_STACK, parseCalendarShown, parseClientMsg, parseEventRef, parseGoogleClient, parseIntegrationTarget, parseMcpServerAdd, parseMergeQueueChange, parseNewEvent, parseProcessStop, parsePromptDocument, parsePullRequestAttachment, parsePullRequestCheckout, parsePullRequestEdit, parsePullRequestFilesQuery, parsePullRequestQuery, parsePullRequestRebase, parsePullRequestViewedEdit, parseRepoQuery, parseReviewDraftEdit, parseReviewDraftPost, parseSlackClient, parseTicketAttachment, parseTicketDraft, parseTicketEdit, parseTodoTicket, parseWorkspaceChange } from "./wire";

const msg = (value: unknown): ClientFrame | null => parseClientMsg(JSON.stringify(value))?.ok ?? null;
const live = { kind: "live", instanceId: "i1", agentId: null };

describe("parseClientMsg", () => {
	test("rejects text that is not a JSON object", () => {
		expect(parseClientMsg("not json")).toBeNull();
		expect(parseClientMsg("[]")).toBeNull();
		expect(parseClientMsg("null")).toBeNull();
		expect(msg({ t: "no-such-message" })).toBeNull();
	});

	test("an ack rides along with any message with a floor not above it, and either one not a counter rejects the message", () => {
		const frame = (ack: unknown, floor: unknown = ack): unknown => parseClientMsg(JSON.stringify({ t: "end", instanceId: "i1", ack, floor }))?.ok ?? null;
		expect(frame(7, 3)).toEqual({ t: "end", instanceId: "i1", ack: 7, floor: 3 });
		expect(frame(undefined)).toEqual({ t: "end", instanceId: "i1" });
		expect(parseClientMsg(JSON.stringify({ t: "end", instanceId: "i1", ack: 7 }))).toBeNull();
		expect(frame(3, 7)).toBeNull();
		expect(frame(1.5)).toBeNull();
		expect(frame(-1)).toBeNull();
		expect(frame("7")).toBeNull();
		expect(frame(null)).toBeNull();
	});

	test("a resume carries only tagged messages, and one bad message rejects the whole resume", () => {
		const end = { t: "end", instanceId: "i1", ack: 2, floor: 1 } as const;
		expect(parseClientMsg(JSON.stringify({ t: "resume", frames: [end] }))?.ok).toEqual({ t: "resume", frames: [end] });
		expect(parseClientMsg(JSON.stringify({ t: "resume", frames: [] }))?.ok).toEqual({ t: "resume", frames: [] });
		expect(parseClientMsg(JSON.stringify({ t: "resume", frames: [end, { t: "end", instanceId: "i1" }] }))).toBeNull();
		expect(parseClientMsg(JSON.stringify({ t: "resume", frames: [{ t: "resume", frames: [], ack: 3, floor: 3 }] }))).toBeNull();
		expect(parseClientMsg(JSON.stringify({ t: "resume" }))).toBeNull();
	});

	test("watch takes only well-formed views and trajectories, and one bad view rejects the whole set", () => {
		expect(msg({ t: "watch", views: [live, { kind: "past", sessionId: "s1" }], trajectories: [{ kind: "past", sessionId: "s1" }] })).toEqual({
			t: "watch",
			views: [{ kind: "live", instanceId: "i1", agentId: null }, { kind: "past", sessionId: "s1" }],
			trajectories: [{ kind: "past", sessionId: "s1" }],
		});
		expect(msg({ t: "watch", views: [live] })).toEqual({ t: "watch", views: [{ kind: "live", instanceId: "i1", agentId: null }], trajectories: [] });
		expect(msg({ t: "watch", views: [live, { kind: "live", instanceId: 7, agentId: null }], trajectories: [] })).toBeNull();
		expect(msg({ t: "watch", views: [live], trajectories: [{ kind: "live", instanceId: "i1" }] })).toBeNull();
		expect(msg({ t: "watch", views: [live], trajectories: "all" })).toBeNull();
		expect(msg({ t: "watch", views: "all", trajectories: [] })).toBeNull();
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
		const routine: RoutineSpec = {
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

	test("schedule adds a message to a session or a new session's start without images, and removes, takes, or sends one by id", () => {
		const change = (value: unknown) => msg({ t: "schedule", change: value });
		const message = { kind: "message", sessionId: "s1", text: "carry on" } as const;
		const add = (fields: Record<string, unknown>) => change({ op: "add", send: { id: "a", at: 1_800_000_000_000, reset: "Anthropic 5h", target: message, ...fields } });
		expect(add({ createdAt: 1, state: { phase: "sending" } })).toEqual({ t: "schedule", change: { op: "add", send: { id: "a", at: 1_800_000_000_000, reset: "Anthropic 5h", target: message } } });
		const request = newSessionRequest("~/code", "Pick up the migration.");
		expect(add({ reset: null, target: { kind: "start", request } })).toMatchObject({ change: { send: { reset: null, target: { kind: "start", request } } } });
		expect(change({ op: "send-now", id: "a" })).toEqual({ t: "schedule", change: { op: "send-now", id: "a" } });
		expect(change({ op: "remove", id: "a" })).toEqual({ t: "schedule", change: { op: "remove", id: "a" } });
		expect(change({ op: "take", id: "a" })).toEqual({ t: "schedule", change: { op: "take", id: "a" } });
		const spec = { id: "a", at: 1_800_000_000_000, reset: null, target: { kind: "start" as const, request } };
		expect(change({ op: "update", send: { ...spec, state: { phase: "waiting" } } })).toEqual({ t: "schedule", change: { op: "update", send: spec } });
		expect(change({ op: "update", send: { ...spec, target: { kind: "start", request: { ...request, prompt: " " } } } })).toBeNull();

		expect(add({ target: { kind: "start", request: { ...request, images: [{ data: "aGVsbG8=", mimeType: "image/png" }] } } })).toBeNull();
		expect(add({ target: { kind: "start", request: { ...request, prompt: " " } } })).toBeNull();
		expect(add({ target: { kind: "start", request: { kind: "resume", sessionId: "s1" } } })).toBeNull();
		expect(add({ target: { ...message, text: "" } })).toBeNull();
		expect(add({ target: { ...message, text: "x".repeat(MAX_SCHEDULED_TEXT + 1) } })).toBeNull();
		expect(add({ at: "tomorrow" })).toBeNull();
		expect(add({ reset: "" })).toBeNull();
		expect(change({ op: "remove", id: "" })).toBeNull();
		const continueTarget = { kind: "continue", sessionId: "s1", provider: "Anthropic", cause: "usage-limit", reply: null };
		expect(add({ target: continueTarget })).toBeNull();
		expect(change({ op: "update", send: { ...spec, target: continueTarget } })).toBeNull();
		expect(change({ op: "continue", send: { ...spec, target: continueTarget } })).toBeNull();
		expect(change({ op: "drop-continue", sessionId: "s1" })).toBeNull();
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

	test("project-create takes a name, a workspace, a first message, a model or null, and a thinking level or null; project takes only a rename or an archive", () => {
		const create = { t: "project-create" as const, reqId: 3, name: "", cwd: "~/code/app", prompt: "Migrate billing.", model: null, thinking: null };
		expect(msg(create)).toEqual(create);
		expect(msg({ ...create, model: { provider: "anthropic", id: "claude" }, thinking: "high" })).toEqual({ ...create, model: { provider: "anthropic", id: "claude" }, thinking: "high" });
		expect(msg({ ...create, thinking: "" })).toBeNull();
		expect(msg({ ...create, prompt: " " })).toBeNull();
		expect(msg({ ...create, cwd: "" })).toBeNull();
		expect(msg({ ...create, name: "x".repeat(201) })).toBeNull();
		expect(msg({ ...create, reqId: -1 })).toBeNull();
		const change = (value: unknown) => msg({ t: "project", change: value });
		expect(change({ op: "rename", id: "p1", name: "Billing v3" })).toEqual({ t: "project", change: { op: "rename", id: "p1", name: "Billing v3" } });
		expect(change({ op: "archive", id: "p1", name: "ignored" })).toEqual({ t: "project", change: { op: "archive", id: "p1" } });
		expect(change({ op: "relink", from: "s1", to: "s2" })).toBeNull();
		expect(change({ op: "archive", id: "" })).toBeNull();
		expect(change({ op: "unarchive", id: "p1" })).toEqual({ t: "project", change: { op: "unarchive", id: "p1" } });
		expect(change({ op: "max-workers", id: "p1", max: 5 })).toEqual({ t: "project", change: { op: "max-workers", id: "p1", max: 5 } });
		expect(change({ op: "max-workers", id: "p1", max: 0 })).toBeNull();
		const watch = { pullRequests: false, linear: { team: "ENG", label: null, project: null } };
		expect(change({ op: "watch", id: "p1", watch })).toEqual({ t: "project", change: { op: "watch", id: "p1", watch } });
		expect(change({ op: "watch", id: "p1", watch: { pullRequests: "yes", linear: null } })).toBeNull();
		expect(change({ op: "review-cadence", id: "p1", cadence: "every 3 PRs" })).toEqual({ t: "project", change: { op: "review-cadence", id: "p1", cadence: "every 3 PRs" } });
		expect(change({ op: "review-cadence", id: "p1", cadence: "x".repeat(201) })).toBeNull();
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
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 12 } }, reviewDraft: true })).toMatchObject({
			reviewDraft: true,
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi" })).toMatchObject({ reviewDraft: false });
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
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", subject: { kind: "ticket", id: "ENG-7" }, reviewDraft: true })).toBeNull();
		expect(msg({ t: "start", reqId: 1, kind: "new", cwd: "~/code", prompt: "hi", reviewDraft: "yes" })).toBeNull();
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
		const reply = { id: "langs", selected: ["TS"], custom: null };
		expect(answer({ kind: "ask", answers: [reply] })).toMatchObject({ answer: { kind: "ask", answers: [reply] } });
		expect(answer({ kind: "ask", answers: [{ ...reply, selected: [1] }] })).toBeNull();
		expect(answer({ kind: "ask", answers: [{ id: "langs", selected: [] }] })).toBeNull();
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

	test("discuss needs a counter id and a passage, its source, and a question within their lengths", () => {
		const request = { source: "session “Fix login”", quote: "ttl: 0", turns: [{ question: "What is ttl?", answer: "How long a token stays cached." }], question: "Why zero?" };
		const ask = { t: "discuss" as const, id: 2, request };
		expect(msg(ask)).toEqual(ask);
		expect(msg({ ...ask, request: { ...request, extra: true } })).toEqual(ask);
		expect(msg({ ...ask, id: -1 })).toBeNull();
		expect(msg({ ...ask, id: 1.5 })).toBeNull();
		expect(msg({ ...ask, request: { ...request, question: "  " } })).toBeNull();
		expect(msg({ ...ask, request: { ...request, quote: "x".repeat(MAX_DISCUSSION_QUOTE + 1) } })).toBeNull();
		expect(msg({ ...ask, request: { ...request, source: "x".repeat(MAX_DISCUSSION_SOURCE + 1) } })).toBeNull();
		expect(msg({ ...ask, request: { ...request, turns: [{ question: "What is ttl?", answer: "" }] } })).toBeNull();
		expect(msg({ ...ask, request: { ...request, turns: Array.from({ length: MAX_DISCUSSION_TURNS + 1 }, () => request.turns[0]) } })).toBeNull();
		expect(msg({ ...ask, request: { ...request, turns: undefined } })).toBeNull();
	});

	test("discuss-stop names the question it stops", () => {
		expect(msg({ t: "discuss-stop", id: 2 })).toEqual({ t: "discuss-stop", id: 2 });
		expect(msg({ t: "discuss-stop", id: "2" })).toBeNull();
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

describe("parsePullRequestFilesQuery", () => {
	test("accepts all changes or a full commit OID, and refuses malformed commit scopes", () => {
		const query = (suffix: string) => parsePullRequestFilesQuery(new URLSearchParams(`owner=acme&repo=app&number=7${suffix}`));
		expect(query("")?.ok).toEqual({ owner: "acme", repo: "app", number: 7 });
		expect(query(`&commit=${"a".repeat(40)}`)?.ok).toEqual({ owner: "acme", repo: "app", number: 7, commit: "a".repeat(40) });
		expect(query(`&commit=${"b".repeat(64)}`)?.ok).toEqual({ owner: "acme", repo: "app", number: 7, commit: "b".repeat(64) });
		for (const commit of ["", "HEAD", "../main", "abc123", "g".repeat(40), "a".repeat(65)]) expect(query(`&commit=${commit}`)).toBeNull();
	});
});

describe("parsePullRequestEdit", () => {
	const pr = { owner: "anthropics", repo: "omp-agents", number: 12 };

	test("takes no viewed change, which has its own route", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "viewed", path: "src/a.ts", on: true } })).toBeNull();
	});

	test("parsePullRequestViewedEdit takes a nonempty path and a boolean direction", () => {
		expect(parsePullRequestViewedEdit({ ...pr, path: "src/a file.ts", on: true })?.ok).toEqual({ ...pr, path: "src/a file.ts", on: true });
		expect(parsePullRequestViewedEdit({ ...pr, path: "src/a.ts", on: false })?.ok).toEqual({ ...pr, path: "src/a.ts", on: false });
		for (const edit of [{ path: "", on: true }, { path: " ", on: false }, { path: 1, on: true }, { path: "a.ts" }, { path: "a.ts", on: 1 }]) expect(parsePullRequestViewedEdit({ ...pr, ...edit })).toBeNull();
		expect(parsePullRequestViewedEdit({ owner: "a/b", repo: "r", number: 1, path: "a.ts", on: true })).toBeNull();
	});

	test("parsePullRequestCheckout takes an absolute cwd, a place, and an optional one-word skill", () => {
		expect(parsePullRequestCheckout({ ...pr, cwd: "/work/app", place: "here" })?.ok).toEqual({ ...pr, cwd: "/work/app", place: "here", skill: null });
		expect(parsePullRequestCheckout({ ...pr, cwd: "/work/app", place: "worktree", skill: "review" })?.ok).toEqual({ ...pr, cwd: "/work/app", place: "worktree", skill: "review" });
		for (const body of [{ cwd: "work/app", place: "here" }, { cwd: " ", place: "here" }, { cwd: "/work/app", place: "local" }, { cwd: "/work/app", place: "here", skill: "two words" }]) expect(parsePullRequestCheckout({ ...pr, ...body })).toBeNull();
	});

	test("parsePullRequestRebase takes a pull request and an absolute cwd", () => {
		expect(parsePullRequestRebase({ ...pr, cwd: "/work/app" })?.ok).toEqual({ ...pr, cwd: "/work/app" });
		for (const body of [{ ...pr, cwd: "work/app" }, { ...pr, cwd: " " }, pr, { ...pr, cwd: "/work/app", number: 0 }]) expect(parsePullRequestRebase(body)).toBeNull();
	});

	test("takes one label, reviewer, or state change to a pull request", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: "good first issue", on: true } })?.ok).toEqual({ ...pr, change: { field: "label", name: "good first issue", on: true } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "reviewer", login: "octo-cat", on: false } })?.ok).toEqual({ ...pr, change: { field: "reviewer", login: "octo-cat", on: false } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "state", state: "draft" } })?.ok).toEqual({ ...pr, change: { field: "state", state: "draft" } });
	});

	test("takes a title or a merge/rebase branch update, but not a blank or oversized title or squash update", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "title", title: "A clear title" } })?.ok).toEqual({ ...pr, change: { field: "title", title: "A clear title" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "update", method: "merge" } })?.ok).toEqual({ ...pr, change: { field: "update", method: "merge" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "update", method: "rebase" } })?.ok).toEqual({ ...pr, change: { field: "update", method: "rebase" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "update", method: "squash" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "title", title: " " } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "title", title: "a".repeat(257) } })).toBeNull();
	});

	test("takes an empty or untrimmed description within GitHub's limit and rejects oversized or non-string descriptions", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: "" } })?.ok).toEqual({ ...pr, change: { field: "body", body: "" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: "  ## Summary\n\nWords.\n" } })?.ok).toEqual({ ...pr, change: { field: "body", body: "  ## Summary\n\nWords.\n" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: "a".repeat(65_536) } })?.ok.change.field).toBe("body");
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: "a".repeat(65_537) } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: null } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "body", body: 7 } })).toBeNull();
	});

	test("rejects the merged state, a merge, which goes through the merge queue, an empty label, a login with a slash, a change without its direction, and no pull request", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "state", state: "merged" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "merge", method: "squash", head: "a".repeat(40) } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: " ", on: true } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "reviewer", login: "org/team", on: true } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "label", name: "bug" } })).toBeNull();
		expect(parsePullRequestEdit({ owner: "a", repo: "b", change: { field: "state", state: "open" } })).toBeNull();
	});

	test("takes a review that can submit: an approval without a summary, a change request or comment only with one", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "approve", body: "" } })?.ok).toEqual({ ...pr, change: { field: "review", verdict: "approve", body: "" } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "request-changes", body: "Fix it." } })?.ok).toEqual({ ...pr, change: { field: "review", verdict: "request-changes", body: "Fix it." } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "comment", body: " " } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "request-changes", body: "" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "dismiss", body: "Hm." } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "review", verdict: "approve", body: "a".repeat(65_537) } })).toBeNull();
	});

	test("parseReviewDraftPost takes a pull request, and the composer's verdict and summary when given", () => {
		expect(parseReviewDraftPost(pr)?.ok).toEqual({ pr });
		expect(parseReviewDraftPost({ ...pr, submit: { verdict: "approve", summary: "" } })?.ok).toEqual({ pr, submit: { verdict: "approve", summary: "" } });
		expect(parseReviewDraftPost({ ...pr, submit: { verdict: "merge", summary: "" } })).toBeNull();
		expect(parseReviewDraftPost({ ...pr, submit: { verdict: "comment" } })).toBeNull();
		expect(parseReviewDraftPost({ owner: "a/b", repo: "r", number: 1 })).toBeNull();
	});

	test("takes a review thread to resolve or unresolve by its new or older node id, a reply to a thread, and a comment on the pull request", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "PRRT_kwDOA-b_1", resolved: true } })?.ok).toEqual({ ...pr, change: { field: "thread", id: "PRRT_kwDOA-b_1", resolved: true } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "MDIzOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMQ==", resolved: false } })?.ok).toEqual({
			...pr,
			change: { field: "thread", id: "MDIzOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMQ==", resolved: false },
		});
		expect(parsePullRequestEdit({ ...pr, change: { field: "reply", thread: "PRRT_kwDOA", body: "Done in a1b2c3." } })?.ok).toEqual({ ...pr, change: { field: "reply", thread: "PRRT_kwDOA", body: "Done in a1b2c3." } });
		expect(parsePullRequestEdit({ ...pr, change: { field: "comment", body: "x".repeat(65_536) } })?.ok).toEqual({ ...pr, change: { field: "comment", body: "x".repeat(65_536) } });
	});

	test("rejects a thread id with other characters or over 100, a thread change without its direction, a blank body, and a body over 65536 characters", () => {
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "PRRT/../x", resolved: true } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "a".repeat(101), resolved: false } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "", resolved: false } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "thread", id: "PRRT_a" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "reply", thread: "PRRT a", body: "ok" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "reply", thread: "PRRT_a", body: " \n\t" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "comment", body: "" } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "comment", body: "x".repeat(65_537) } })).toBeNull();
		expect(parsePullRequestEdit({ ...pr, change: { field: "comment", body: 42 } })).toBeNull();
	});
});

describe("parseReviewDraftEdit", () => {
	const pr = { owner: "acme", repo: "app", number: 7 };
	const head = "a".repeat(40);

	test("takes a line or range to add on either side, its path trimmed, and an edit of a numbered finding", () => {
		const change: ReviewDraftEdit = { op: "add-finding", pr, head, finding: { path: " src/a.ts ", line: 8, startLine: 5, side: "LEFT", body: "Deleted range." } };
		const expected: ReviewDraftEdit = { op: "add-finding", pr, head, finding: { path: "src/a.ts", line: 8, startLine: 5, side: "LEFT", body: "Deleted range." } };
		expect(parseReviewDraftEdit(change)?.ok).toEqual(expected);
		expect(msg({ t: "review-draft", change })).toEqual({ t: "review-draft", change: expected });
		const line = { path: "src/a.ts", line: 8, startLine: null, side: "RIGHT", body: "One line." } as const;
		expect(parseReviewDraftEdit({ op: "add-finding", pr, head, finding: line })?.ok).toEqual({ op: "add-finding", pr, head, finding: line });
		expect(parseReviewDraftEdit({ op: "add-finding", pr, head: "b".repeat(64), finding: line })?.ok).toEqual({ op: "add-finding", pr, head: "b".repeat(64), finding: line });
		expect(parseReviewDraftEdit({ op: "finding", pr, id: "f12", path: "a.ts", startLine: 2, line: 4, side: "RIGHT", body: "Edited." })?.ok).toEqual({
			op: "finding", pr, id: "f12", path: "a.ts", startLine: 2, line: 4, side: "RIGHT", body: "Edited.",
		});
	});

	test("rejects malformed additions, invalid ranges and sides, and a finding on no line", () => {
		const finding = { path: "src/a.ts", line: 8, startLine: null, side: "RIGHT", body: "One line." };
		const change = { op: "add-finding", pr, head, finding };
		expect(parseReviewDraftEdit({ ...change, head: "abc1234" })).toBeNull();
		expect(parseReviewDraftEdit({ ...change, head: "z".repeat(40) })).toBeNull();
		expect(parseReviewDraftEdit({ ...change, finding: null })).toBeNull();
		for (const over of [
			{ line: null }, { line: 0 }, { line: 1.5 },
			{ startLine: 0 }, { startLine: 9 }, { startLine: 1.5 }, { startLine: undefined }, { side: "BASE" }, { side: undefined },
			{ path: " " }, { body: " " }, { body: "x".repeat(65_537) },
		]) {
			expect(parseReviewDraftEdit({ ...change, finding: { ...finding, ...over } })).toBeNull();
		}
		expect(parseReviewDraftEdit({ op: "finding", pr, id: "f1", ...finding, startLine: 9 })).toBeNull();
		expect(parseReviewDraftEdit({ op: "finding", pr, id: "f1", ...finding, line: null, startLine: 1 })).toBeNull();
		expect(parseReviewDraftEdit({ op: "finding", pr, id: "code-1", ...finding })).toBeNull();
	});

	test("takes a verdict, a summary, one finding's place and text, findings' states, and a discard", () => {
		expect(parseReviewDraftEdit({ pr, op: "verdict", verdict: "request-changes" })?.ok).toEqual({ pr, op: "verdict", verdict: "request-changes" });
		expect(parseReviewDraftEdit({ pr, op: "summary", summary: "" })?.ok).toEqual({ pr, op: "summary", summary: "" });
		expect(parseReviewDraftEdit({ pr, op: "finding", id: "f2", path: " src/a.ts ", line: null, startLine: null, side: "RIGHT", body: "Nit." })?.ok).toEqual({ pr, op: "finding", id: "f2", path: "src/a.ts", line: null, startLine: null, side: "RIGHT", body: "Nit." });
		expect(parseReviewDraftEdit({ pr, op: "finding-state", ids: ["f1", "f3"], state: "dismissed" })?.ok).toEqual({ pr, op: "finding-state", ids: ["f1", "f3"], state: "dismissed" });
		expect(parseReviewDraftEdit({ pr, op: "discard", extra: 1 })?.ok).toEqual({ pr, op: "discard" });
	});

	test("rejects an unknown verdict or state, a finding on line 0, a blank body, a malformed id, and no pull request", () => {
		expect(parseReviewDraftEdit({ pr, op: "verdict", verdict: "lgtm" })).toBeNull();
		expect(parseReviewDraftEdit({ pr, op: "finding-state", ids: ["f1"], state: "done" })).toBeNull();
		expect(parseReviewDraftEdit({ pr, op: "finding", id: "f1", path: "a.ts", line: 0, body: "x" })).toBeNull();
		expect(parseReviewDraftEdit({ pr, op: "finding", id: "f1", path: "a.ts", line: 3, body: " " })).toBeNull();
		expect(parseReviewDraftEdit({ pr, op: "finding-state", ids: ["bad id"], state: "accepted" })).toBeNull();
		expect(parseReviewDraftEdit({ pr, op: "finding-state", ids: [], state: "accepted" })).toBeNull();
		expect(parseReviewDraftEdit({ op: "discard" })).toBeNull();
	});

	test("rides the review-draft message", () => {
		expect(msg({ t: "review-draft", change: { pr, op: "discard" } })).toEqual({ t: "review-draft", change: { pr, op: "discard" } });
		expect(msg({ t: "review-draft", change: { pr, op: "nope" } })).toBeNull();
	});
});

describe("parseMergeQueueChange", () => {
	const pr = { owner: "anthropics", repo: "omp-agents", number: 12 };

	test("takes a merge of pull requests, each with the head the confirmation showed or none, and a cancel", () => {
		const add = { op: "add" as const, method: "squash" as const, prs: [{ ...pr, head: "a".repeat(40) }, { ...pr, number: 13, head: null }] };
		expect(parseMergeQueueChange(add)?.ok).toEqual(add);
		expect(parseMergeQueueChange({ op: "cancel", id: "m1" })?.ok).toEqual({ op: "cancel", id: "m1" });
	});

	test("rejects an unknown merge method, a head that is not a commit, no pull request, too tall a stack, and a cancel without an id", () => {
		expect(parseMergeQueueChange({ op: "add", method: "fast-forward", prs: [{ ...pr, head: null }] })).toBeNull();
		expect(parseMergeQueueChange({ op: "add", method: "merge", prs: [{ ...pr, head: "main" }] })).toBeNull();
		expect(parseMergeQueueChange({ op: "add", method: "merge", prs: [] })).toBeNull();
		expect(parseMergeQueueChange({ op: "add", method: "merge", prs: Array.from({ length: MAX_QUEUED_STACK + 1 }, (_, index) => ({ ...pr, number: index + 1, head: null })) })).toBeNull();
		expect(parseMergeQueueChange({ op: "cancel", id: "" })).toBeNull();
	});
});

describe("parseRepoQuery", () => {
	test("names a repository by owner and name, each without a slash or space", () => {
		expect(parseRepoQuery(new URLSearchParams("owner=anthropics&repo=omp.agents"))?.ok).toEqual({ owner: "anthropics", repo: "omp.agents" });
		expect(parseRepoQuery(new URLSearchParams("owner=anthropics&repo=.github"))?.ok).toEqual({ owner: "anthropics", repo: ".github" });
		expect(parseRepoQuery(new URLSearchParams("owner=a/b&repo=c"))).toBeNull();
		expect(parseRepoQuery(new URLSearchParams("owner=a"))).toBeNull();
	});

	test("refuses a name that would climb a REST path or read as a flag", () => {
		for (const query of ["owner=..&repo=users", "owner=a&repo=.", "owner=a&repo=..", "owner=-R&repo=x"]) expect(parseRepoQuery(new URLSearchParams(query))).toBeNull();
	});
});

describe("parseIntegrationTarget", () => {
	test("takes an MCP integration, an account only for Gmail or Google Calendar, and null to add one", () => {
		expect(parseIntegrationTarget({ id: "linear" })?.ok).toEqual({ id: "linear", account: null });
		expect(parseIntegrationTarget({ id: "slack", account: null })?.ok).toEqual({ id: "slack", account: null });
		expect(parseIntegrationTarget({ id: "gmail", account: "gmail-2" })?.ok).toEqual({ id: "gmail", account: "gmail-2" });
		expect(parseIntegrationTarget({ id: "google-calendar", account: null })?.ok).toEqual({ id: "google-calendar", account: null });
		expect(parseIntegrationTarget({ id: "linear", account: "linear" })).toBeNull();
		expect(parseIntegrationTarget({ id: "gmail", account: "" })).toBeNull();
		expect(parseIntegrationTarget({ id: "Linear" })).toBeNull();
		expect(parseIntegrationTarget({ id: "google" })).toBeNull();
		expect(parseIntegrationTarget("linear")).toBeNull();
		expect(parseIntegrationTarget(null)).toBeNull();
	});
});

describe("parseCalendarShown", () => {
	test("takes an account, a calendar id, and a boolean, and refuses an empty id or another value for shown", () => {
		expect(parseCalendarShown({ account: "google-calendar", id: "team@group.calendar.google.com", shown: false })?.ok).toEqual({ account: "google-calendar", id: "team@group.calendar.google.com", shown: false });
		expect(parseCalendarShown({ account: "google-calendar-2", id: "max@example.com", shown: true, extra: 1 })?.ok).toEqual({ account: "google-calendar-2", id: "max@example.com", shown: true });
		expect(parseCalendarShown({ id: "max@example.com", shown: true })).toBeNull();
		expect(parseCalendarShown({ account: "google-calendar", id: "", shown: true })).toBeNull();
		expect(parseCalendarShown({ account: "google-calendar", id: "max@example.com", shown: "false" })).toBeNull();
	});
});

describe("parseNewEvent", () => {
	const timed = { allDay: false, start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") };

	test("takes a trimmed title, all-day days or a timed span, and this computer or a Google calendar", () => {
		expect(parseNewEvent({ title: "  Offsite ", when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-15" }, calendar: { kind: "local" }, extra: 1 })?.ok).toEqual({
			title: "Offsite",
			when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-15" },
			calendar: { kind: "local" },
		});
		expect(parseNewEvent({ title: "Retro", when: timed, calendar: { kind: "google", account: "google-calendar", calendarId: "max@example.com" } })?.ok).toEqual({
			title: "Retro",
			when: { allDay: false, start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") },
			calendar: { kind: "google", account: "google-calendar", calendarId: "max@example.com" },
		});
		expect(parseNewEvent({ title: "One day", when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-14" }, calendar: { kind: "local" } })?.ok.title).toBe("One day");
	});

	test("refuses an empty or overlong title, an end at or before the start, a last day before the first, a bad day, or an unknown calendar", () => {
		const local = { kind: "local" };
		expect(parseNewEvent({ title: "  ", when: timed, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "x".repeat(501), when: timed, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Retro", when: { ...timed, end: timed.start }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Retro", when: { ...timed, end: timed.start - 1 }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Retro", when: { ...timed, start: 1.5 }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Trip", when: { allDay: true, firstDay: "2026-10-15", lastDay: "2026-10-14" }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Trip", when: { allDay: true, firstDay: "2026-02-30", lastDay: "2026-03-01" }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Trip", when: { allDay: true, firstDay: "14/10/2026", lastDay: "2026-10-15" }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Trip", when: { allDay: "yes", firstDay: "2026-10-14", lastDay: "2026-10-15" }, calendar: local })).toBeNull();
		expect(parseNewEvent({ title: "Retro", when: timed, calendar: { kind: "google", calendarId: "" } })).toBeNull();
		expect(parseNewEvent({ title: "Retro", when: timed, calendar: { kind: "outlook" } })).toBeNull();
	});
});

describe("parseEventRef", () => {
	test("names an event kept on this computer by its id, or a Google event by its calendar's id and its own", () => {
		expect(parseEventRef({ kind: "local", id: "e1", extra: 1 })?.ok).toEqual({ kind: "local", id: "e1" });
		expect(parseEventRef({ kind: "google", account: "google-calendar", calendarId: "max@example.com", eventId: "standup_20261005T073000Z" })?.ok).toEqual({
			kind: "google",
			account: "google-calendar",
			calendarId: "max@example.com",
			eventId: "standup_20261005T073000Z",
		});
	});

	test("refuses an empty id, a Google event without both ids, or another kind", () => {
		expect(parseEventRef({ kind: "local", id: "" })).toBeNull();
		expect(parseEventRef({ id: "e1" })).toBeNull();
		expect(parseEventRef({ kind: "google", calendarId: "max@example.com" })).toBeNull();
		expect(parseEventRef({ kind: "google", calendarId: "", eventId: "e1" })).toBeNull();
		expect(parseEventRef({ kind: "outlook", id: "e1" })).toBeNull();
		expect(parseEventRef("e1")).toBeNull();
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

describe("parseTodoTicket", () => {
	test("takes a todo and a team by id, and drops any other field", () => {
		expect(parseTodoTicket({ todoId: "a", team: "t1", title: "ignored" })?.ok).toEqual({ todoId: "a", team: "t1" });
		expect(parseTodoTicket({ todoId: "", team: "t1" })).toBeNull();
		expect(parseTodoTicket({ todoId: "x".repeat(65), team: "t1" })).toBeNull();
		expect(parseTodoTicket({ todoId: "a", team: " " })).toBeNull();
		expect(parseTodoTicket({ todoId: "a" })).toBeNull();
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

describe("parsePullRequestAttachment", () => {
	const image = { name: "page.png", type: "image/png" as const, data: "aGVsbG8=", alt: "The sidebar #2" };
	const body = { owner: "acme", repo: "app", number: 7, files: [image] };

	test("takes a pull request and up to the attachment limit of images in base64, each with alt text, empty alt included", () => {
		expect(parsePullRequestAttachment(body)?.ok).toEqual(body);
		const most = { ...body, files: Array.from({ length: MAX_PULL_REQUEST_ATTACHMENTS }, () => ({ ...image, alt: "" })) };
		expect(parsePullRequestAttachment(most)?.ok).toEqual(most);
	});

	test("rejects no images or more than the limit, a bad pull request, and a file gh does not upload", () => {
		expect(parsePullRequestAttachment({ ...body, files: [] })).toBeNull();
		expect(parsePullRequestAttachment({ ...body, files: Array.from({ length: MAX_PULL_REQUEST_ATTACHMENTS + 1 }, () => image) })).toBeNull();
		expect(parsePullRequestAttachment({ ...body, owner: "ac me" })).toBeNull();
		expect(parsePullRequestAttachment({ ...body, repo: "" })).toBeNull();
		expect(parsePullRequestAttachment({ ...body, number: 0 })).toBeNull();
		for (const file of [
			{ ...image, name: "" },
			{ ...image, type: "image/avif" },
			{ ...image, type: "application/pdf" },
			{ ...image, data: "" },
			{ ...image, data: "not base64!" },
			{ ...image, data: "A".repeat(Math.ceil(MAX_PULL_REQUEST_IMAGE_BYTES / 3) * 4 + 4) },
			{ ...image, alt: undefined },
		]) {
			expect(parsePullRequestAttachment({ ...body, files: [file] })).toBeNull();
		}
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

describe("parseMcpServerAdd", () => {
	const server = { name: "docs", url: "https://mcp.example.com/mcp" };

	test("takes a catalog entry by id, or a server by name and address with HTTP as its default transport", () => {
		expect(parseMcpServerAdd({ catalog: "sentry" })).toEqual({ ok: { kind: "catalog", id: "sentry" } });
		expect(parseMcpServerAdd({ ...server, name: " docs " })).toEqual({ ok: { kind: "custom", ...server, transport: "http", header: null } });
		expect(parseMcpServerAdd({ ...server, transport: "sse" })).toMatchObject({ ok: { transport: "sse" } });
		expect(parseMcpServerAdd({ ...server, transport: "stdio" })).toEqual({ error: "Expected transport http or sse." });
	});

	test("refuses plain HTTP off this computer, so a sign-in never crosses the network in the clear", () => {
		const refused = { error: "Enter the server's https:// address." };
		expect(parseMcpServerAdd({ ...server, url: "http://mcp.example.com/mcp" })).toEqual(refused);
		expect(parseMcpServerAdd({ ...server, url: "mcp.example.com" })).toEqual(refused);
		for (const host of ["localhost:3845", "127.0.0.1", "[::1]:8000"]) expect(parseMcpServerAdd({ ...server, url: `http://${host}/mcp` })).toHaveProperty("ok");
	});

	test("takes a header only with a token name and a value", () => {
		expect(parseMcpServerAdd({ ...server, header: { name: "Authorization", value: " Bearer k " } })).toMatchObject({ ok: { header: { name: "Authorization", value: "Bearer k" } } });
		expect(parseMcpServerAdd({ ...server, header: { name: "Bad Name", value: "k" } })).toEqual({ error: "Enter the header's name, such as Authorization." });
		expect(parseMcpServerAdd({ ...server, header: { name: "X-Api-Key", value: " " } })).toEqual({ error: "Enter the header's value." });
	});
});

describe("replay start requests", () => {
	const start = { t: "start", reqId: 7, kind: "replay", view: { kind: "past", sessionId: "source" }, token: "pinned-source", model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinking: "low", prompt: null } as const;
	test("keeps explicit choices and the server-owned source token", () => {
		expect(msg(start)).toEqual(start);
		expect(msg({ ...start, prompt: "edited" })).toEqual({ ...start, prompt: "edited" });
	});
	test("rejects malformed tokens, settings, and views instead of accepting a raw source path", () => {
		for (const change of [{ token: null }, { token: "" }, { thinking: 3 }, { prompt: {} }, { model: { provider: "openai-codex" } }, { view: { file: "/arbitrary/source.jsonl" } }]) expect(msg({ ...start, ...change })).toBeNull();
	});
});

describe("parseProcessStop", () => {
	test("takes a session's instance id and one of its process ids, and nothing else", () => {
		expect(parseProcessStop({ instanceId: "i1", id: '["job",110,"Fri Oct 3 09:00:00 2026"]' })).toEqual({ ok: { instanceId: "i1", id: '["job",110,"Fri Oct 3 09:00:00 2026"]' } });
		expect(parseProcessStop({ instanceId: "i1", id: "" })).toBeNull();
		expect(parseProcessStop({ instanceId: " ", id: "x" })).toBeNull();
		expect(parseProcessStop({ instanceId: "i1", id: 7 })).toBeNull();
		expect(parseProcessStop(null)).toBeNull();
	});
});
