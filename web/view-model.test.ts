import { describe, expect, test } from "bun:test";
import type { AgentRow, CatalogModel, InboxPullRequest, Item, PastSession, RosterHost } from "../src/shared";
import {
	agentTree,
	applyItems,
	closePane,
	defaultCwd,
	forkPoints,
	hashForLayout,
	hashForSettings,
	hashForView,
	INBOX_HASH,
	inboxSections,
	type Layout,
	layoutFromHash,
	matchesFilter,
	modelName,
	modelOrg,
	openView,
	settingsFromHash,
	splitSelector,
	toBlocks,
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

describe("layout hash", () => {
	const live = (instanceId: string, agentId: string | null = null) => ({ kind: "live", instanceId, agentId }) as const;
	const past = (sessionId: string) => ({ kind: "past", sessionId }) as const;

	test("one pane keeps the single-view hash, so links from before split screen still open", () => {
		const view = live("7c51f77b2a1bf7ba", "Parent/Child #2");
		expect(hashForLayout({ panes: [view], focus: 0 })).toBe("#7c51f77b2a1bf7ba/Parent%2FChild%20%232");
		expect(hashForLayout({ panes: [view], focus: 0 })).toBe(hashForView(view));
		expect(layoutFromHash("#7c51f77b2a1bf7ba/Parent%2FChild%20%232")).toEqual({ panes: [view], focus: 0 });
		expect(layoutFromHash("#7c51f77b2a1bf7ba")).toEqual({ panes: [live("7c51f77b2a1bf7ba")], focus: 0 });
		expect(layoutFromHash("")).toEqual({ panes: [], focus: 0 });
		expect(hashForLayout({ panes: [], focus: 0 })).toBe("");
	});

	test("a past session is not read as a subagent of an instance named `past`", () => {
		expect(hashForView(past("01a0f6a5-181e"))).toBe("#past/01a0f6a5-181e");
		expect(layoutFromHash("#past/01a0f6a5-181e")).toEqual({ panes: [past("01a0f6a5-181e")], focus: 0 });
	});

	test("several panes round-trip in order with the focused one, ids with commas and @ included", () => {
		const layout: Layout = { panes: [live("a1"), live("a1", "x,y@z"), past("s,1"), live("b2")], focus: 2 };
		const hash = hashForLayout(layout);
		expect(hash).toBe("#a1,a1/x%2Cy%40z,past/s%2C1,b2@2");
		expect(layoutFromHash(hash)).toEqual(layout);
		expect(hashForLayout({ panes: [live("a1"), live("b2")], focus: 0 })).toBe("#a1,b2");
	});

	test("keeps the first four distinct views and focus on the view the hash named", () => {
		expect(layoutFromHash("#a,b,c,d,e")).toEqual({ panes: [live("a"), live("b"), live("c"), live("d")], focus: 0 });
		expect(layoutFromHash("#a,b,a,c@2")).toEqual({ panes: [live("a"), live("b"), live("c")], focus: 0 });
		expect(layoutFromHash("#a,b,a,c@3")).toEqual({ panes: [live("a"), live("b"), live("c")], focus: 2 });
		expect(layoutFromHash("#a,b,c,d,e@4")).toEqual({ panes: [live("a"), live("b"), live("c"), live("d")], focus: 0 });
		expect(layoutFromHash("#a,b@9")).toEqual({ panes: [live("a"), live("b")], focus: 0 });
		expect(layoutFromHash("#a,b@x")).toEqual({ panes: [live("a"), live("b")], focus: 0 });
	});

	test("the settings page is not read as a layout, and its workspace keeps its slashes", () => {
		const hash = hashForSettings("/Users/me/code/my app");
		expect(hash).toBe("#settings/%2FUsers%2Fme%2Fcode%2Fmy%20app");
		expect(settingsFromHash(hash)).toEqual({ cwd: "/Users/me/code/my app" });
		expect(layoutFromHash(hash)).toBeNull();
		expect(settingsFromHash("#settings")).toEqual({ cwd: null });
		expect(layoutFromHash("#settings")).toBeNull();
		expect(settingsFromHash("#7c51f77b2a1bf7ba")).toBeNull();
	});

	test("the inbox page is not read as a layout", () => {
		expect(layoutFromHash(INBOX_HASH)).toBeNull();
	});
});

describe("inbox sections", () => {
	const pr = (number: number, fields: Partial<InboxPullRequest>): InboxPullRequest => ({
		owner: "acme",
		repo: "webapp",
		number,
		title: `PR ${number}`,
		author: "me",
		role: "author",
		state: "open",
		review: "review-required",
		checks: "passing",
		head: `me/branch-${number}`,
		stackedOn: null,
		updatedAt: number,
		...fields,
	});

	test("each PR lands in the first section that takes it, newest first, and empty sections drop out", () => {
		const sections = inboxSections([
			pr(1, { role: "reviewer", review: "changes-requested", author: "teammate" }),
			pr(2, { review: "changes-requested" }),
			pr(3, { review: "approved" }),
			pr(4, {}),
			pr(5, { review: "none" }),
			pr(6, { state: "draft", review: "approved" }),
			pr(7, { state: "merged", review: "approved" }),
			pr(8, { role: "reviewer", state: "merged" }),
		]);
		expect(sections.map(section => [section.title, section.pullRequests.map(p => p.number)])).toEqual([
			["Needs your review", [1]],
			["Returned to you", [2]],
			["Approved", [3]],
			["Waiting for review", [5, 4]],
			["Drafts", [6]],
			["Recently merged", [8, 7]],
		]);
		expect(inboxSections([pr(1, { state: "draft" })]).map(section => section.title)).toEqual(["Drafts"]);
	});
});

describe("opening and closing panes", () => {
	const view = (instanceId: string) => ({ kind: "live", instanceId, agentId: null }) as const;
	const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(view);

	test("a plain open replaces the focused pane; a split adds a focused pane", () => {
		expect(openView({ panes: [], focus: 0 }, a, "split")).toEqual({ panes: [a], focus: 0 });
		expect(openView({ panes: [a, b], focus: 1 }, c, "replace")).toEqual({ panes: [a, c], focus: 1 });
		expect(openView({ panes: [a, b], focus: 0 }, c, "split")).toEqual({ panes: [a, b, c], focus: 2 });
	});

	test("a split with four panes open replaces the focused one", () => {
		expect(openView({ panes: [a, b, c, d], focus: 1 }, e, "split")).toEqual({ panes: [a, e, c, d], focus: 1 });
	});

	test("a view already open gets focus instead of a second pane", () => {
		expect(openView({ panes: [a, b, c], focus: 0 }, c, "split")).toEqual({ panes: [a, b, c], focus: 2 });
		expect(openView({ panes: [a, b, c], focus: 0 }, b, "replace")).toEqual({ panes: [a, b, c], focus: 1 });
	});

	test("closing keeps focus on its view, or moves it to the pane taking the closed one's place", () => {
		expect(closePane({ panes: [a, b, c], focus: 2 }, 0)).toEqual({ panes: [b, c], focus: 1 });
		expect(closePane({ panes: [a, b, c], focus: 1 }, 1)).toEqual({ panes: [a, c], focus: 1 });
		expect(closePane({ panes: [a, b, c], focus: 2 }, 2)).toEqual({ panes: [a, b], focus: 1 });
		expect(closePane({ panes: [a, b], focus: 0 }, 1)).toEqual({ panes: [a], focus: 0 });
		expect(closePane({ panes: [a], focus: 0 }, 0)).toEqual({ panes: [], focus: 0 });
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

describe("splitSelector", () => {
	const listed = (selector: string): [string, CatalogModel] => [selector, { selector, provider: "openrouter", name: selector, thinking: ["low"] }];
	const models = new Map([listed("openrouter/minimax/minimax-m3"), listed("openrouter/minimax/minimax-m3:batch")]);

	test("a colon that belongs to a listed model id is not a thinking level", () => {
		expect(splitSelector("openrouter/minimax/minimax-m3:batch", models)).toEqual({ model: "openrouter/minimax/minimax-m3:batch", level: null });
		expect(splitSelector("openrouter/minimax/minimax-m3:batch:low", models)).toEqual({
			model: "openrouter/minimax/minimax-m3:batch",
			level: "low",
		});
		expect(splitSelector("openrouter/minimax/minimax-m3:low", models)).toEqual({ model: "openrouter/minimax/minimax-m3", level: "low" });
		expect(splitSelector("cursor/grok-4.7-high", models)).toEqual({ model: "cursor/grok-4.7-high", level: null });
	});
});
