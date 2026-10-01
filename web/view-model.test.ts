import { describe, expect, test } from "bun:test";
import type { AgentRow, Item, PastSession, RosterHost } from "../src/shared";
import {
	agentTree,
	applyItems,
	defaultCwd,
	forkPoints,
	hashForView,
	matchesFilter,
	modelName,
	modelOrg,
	toBlocks,
	viewFromHash,
} from "./view-model";

const agent = (id: string, parentId: string | null): AgentRow => ({
	id,
	kind: "task",
	parentId,
	status: "running",
	activity: null,
	canMessage: true,
});

describe("model labels", () => {
	test("a direct provider's model drops the provider and the claude- prefix", () => {
		expect(modelName("anthropic/claude-opus-5-5")).toBe("opus-5-5");
		expect(modelOrg("anthropic/claude-opus-5-5")).toBe("anthropic");
		expect(modelName("openai-codex/gpt-5.5")).toBe("gpt-5.5");
		expect(modelOrg("openai-codex/gpt-5.5")).toBe("openai");
	});

	test("a reseller's model belongs to the family's org", () => {
		expect(modelOrg("cursor/claude-opus-4-7")).toBe("anthropic");
		expect(modelOrg("cursor/composer-2")).toBe("cursor");
	});

	test("a router's org/model id names the org", () => {
		expect(modelName("openrouter/~anthropic/claude-opus-latest")).toBe("opus-latest");
		expect(modelOrg("openrouter/~anthropic/claude-opus-latest")).toBe("anthropic");
		expect(modelName("openrouter/moonshotai/kimi-k3")).toBe("kimi-k3");
		expect(modelOrg("openrouter/z-ai/glm-5.3")).toBe("z-ai");
	});
});

describe("agentTree", () => {
	test("orders children under their parent with increasing depth", () => {
		const nodes = agentTree([agent("B", null), agent("A1", "A"), agent("A", null), agent("A1a", "A1")]);
		expect(nodes.map(({ agent, depth }) => `${agent.id}:${depth}`)).toEqual(["B:0", "A:0", "A1:1", "A1a:2"]);
	});

	test("a child whose parent is not listed becomes a top-level row", () => {
		expect(agentTree([agent("Orphan", "Gone")]).map(({ agent, depth }) => `${agent.id}:${depth}`)).toEqual(["Orphan:0"]);
	});
});

describe("view hash", () => {
	test("round-trips session and subagent views, including ids that need escaping", () => {
		const view = { kind: "live", instanceId: "7c51f77b2a1bf7ba", agentId: "Parent/Child #2" } as const;
		expect(viewFromHash(hashForView(view))).toEqual(view);
		expect(viewFromHash("#7c51f77b2a1bf7ba")).toEqual({ kind: "live", instanceId: "7c51f77b2a1bf7ba", agentId: null });
		expect(viewFromHash("")).toBeNull();
	});

	test("a past session is not read as a subagent of an instance named `past`", () => {
		expect(hashForView({ kind: "past", sessionId: "01a0f6a5-181e" })).toBe("#past/01a0f6a5-181e");
		expect(viewFromHash("#past/01a0f6a5-181e")).toEqual({ kind: "past", sessionId: "01a0f6a5-181e" });
	});
});

describe("defaultCwd", () => {
	const host = (instanceId: string, cwdDisplay: string, startedAt: number) => ({ instanceId, cwdDisplay, startedAt }) as RosterHost;
	const past = (sessionId: string, cwdDisplay: string) => ({ sessionId, cwdDisplay }) as PastSession;
	const hosts = [host("a", "~/old", 1), host("b", "~/new", 2)];
	const sessions = [past("s1", ""), past("s2", "~/saved")];

	test("prefers the open session, then the newest live one, then the newest past one with a directory", () => {
		expect(defaultCwd({ kind: "live", instanceId: "a", agentId: null }, hosts, sessions)).toBe("~/old");
		expect(defaultCwd({ kind: "past", sessionId: "s2" }, hosts, sessions)).toBe("~/saved");
		expect(defaultCwd(null, hosts, sessions)).toBe("~/new");
		expect(defaultCwd({ kind: "past", sessionId: "s1" }, [], sessions)).toBe("~/saved");
		expect(defaultCwd(null, [], [])).toBe("~");
	});
});

describe("matchesFilter", () => {
	const session = {
		sessionId: "s1",
		title: "Fix all outstanding problems",
		cwd: "/Users/me/code/webapp",
		cwdDisplay: "~/code/webapp",
		modifiedAt: 0,
		pullRequests: [{ owner: "acme", repo: "webapp", number: 6596 }],
	} satisfies PastSession;
	const matches = (query: string) => matchesFilter(session, session.title, query);

	test("a pasted PR link matches only the sessions that submitted that exact PR", () => {
		expect(matches("https://github.com/acme/webapp/pull/6596/files")).toBe(true);
		expect(matches("https://app.graphite.com/github/pr/Acme/webapp/6596")).toBe(true);
		expect(matches("https://github.com/acme/webapp/pull/6597")).toBe(false);
		expect(matches("https://github.com/other/webapp/pull/6596")).toBe(false);
	});

	test("a PR number matches the PR; other text matches the title or directory", () => {
		expect(matches("#6596")).toBe(true);
		expect(matches(" 6596 ")).toBe(true);
		expect(matches("6597")).toBe(false);
		expect(matches("OUTSTANDING")).toBe(true);
		expect(matches("code/webapp")).toBe(true);
		expect(matches("composer")).toBe(false);
		expect(matches("")).toBe(true);
	});
});

describe("transcript rendering", () => {
	const user: Item = { id: "u", kind: "user", text: "go", from: null, entryId: "e-u" };
	const tool = (id: string, status: "running" | "ok"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status });

	test("upserts keep position and append new ids", () => {
		const items = applyItems([user, tool("t1", "running")], false, [tool("t1", "ok"), tool("t2", "running")]);
		expect(items.map(item => (item.kind === "tool" ? `${item.id}:${item.status}` : item.id))).toEqual(["u", "t1:ok", "t2:running"]);
	});

	test("consecutive tools group into one block; a message splits groups", () => {
		const blocks = toBlocks([tool("t1", "ok"), tool("t2", "ok"), user, tool("t3", "running")]);
		expect(blocks.map(block => (block.kind === "tools" ? block.tools.map(t => t.id).join("+") : block.item.id))).toEqual([
			"t1+t2",
			"u",
			"t3",
		]);
	});
});

describe("forkPoints", () => {
	const prompt = (id: string, entryId: string | null): Item => ({ id, kind: "user", text: id, from: null, entryId });
	const reply = (id: string, streaming = false): Item => ({ id, kind: "assistant", text: id, streaming });
	const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok" };

	test("a prompt forks at itself; a turn's last reply forks at the next prompt, keeping the whole turn", () => {
		const items = [prompt("p1", "e1"), reply("r1a"), tool, reply("r1b"), prompt("p2", "e2"), reply("r2")];
		expect(Object.fromEntries(forkPoints(items))).toEqual({
			p1: { entryId: "e1", prefill: true },
			r1b: { entryId: "e2", prefill: false },
			p2: { entryId: "e2", prefill: true },
		});
	});

	test("a reply forks only when a prompt omp can branch at follows it, and not while it streams", () => {
		const items = [
			prompt("p1", "e1"),
			reply("r1"),
			prompt("collab", null),
			reply("r2"),
			prompt("p3", "e3"),
			reply("r3", true),
			prompt("steer", "e4"),
			reply("r4"),
		];
		expect(Object.fromEntries(forkPoints(items))).toEqual({
			p1: { entryId: "e1", prefill: true },
			r2: { entryId: "e3", prefill: false },
			p3: { entryId: "e3", prefill: true },
			steer: { entryId: "e4", prefill: true },
		});
	});
});
