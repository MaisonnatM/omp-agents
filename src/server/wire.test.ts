import { describe, expect, test } from "bun:test";
import type { ClientMsg } from "../shared";
import { parseClientMsg, parsePullRequestQuery, parseSessionLinks } from "./wire";

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

	test("prompt needs a live view, non-blank text, and a known delivery", () => {
		expect(msg({ t: "prompt", view: live, text: "go", delivery: "followUp" })).toMatchObject({ t: "prompt", delivery: "followUp" });
		expect(msg({ t: "prompt", view: live, text: "  ", delivery: "steer" })).toBeNull();
		expect(msg({ t: "prompt", view: live, text: "go", delivery: "later" })).toBeNull();
		expect(msg({ t: "prompt", view: { kind: "past", sessionId: "s1" }, text: "go", delivery: "steer" })).toBeNull();
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
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", extra: 1 })).toEqual({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", branch: null, model: null, thinking: null });
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", thinking: "high" })).toMatchObject({ thinking: "high" });
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", model: { provider: "anthropic", id: "claude-opus-5-5", name: "Opus" } })).toMatchObject({
			model: { provider: "anthropic", id: "claude-opus-5-5" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "existing", name: "fix/login", base: "main" } })).toMatchObject({
			branch: { kind: "existing", name: "fix/login" },
		});
		expect(msg({ t: "start", reqId: 4, kind: "new", cwd: "~/code", prompt: "hi", branch: { kind: "new", name: "feat", base: "main" } })).toMatchObject({
			branch: { kind: "new", name: "feat", base: "main" },
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
