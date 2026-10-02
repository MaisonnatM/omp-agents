import { describe, expect, test } from "bun:test";
import type { AgentRow, CatalogModel, InboxPullRequest, Item, PastSession, RosterHost, View } from "../src/shared";
import {
	agentTree,
	applyItems,
	closePane,
	defaultCwd,
	forkPoints,
	hashForInbox,
	hashForLayout,
	hashForSettings,
	hashForView,
	inboxFromHash,
	inboxSections,
	type Layout,
	layoutFromHash,
	matchesFilter,
	modelName,
	modelOrg,
	openView,
	sessionFromHash,
	settingsFromHash,
	splitSelector,
	toBlocks,
	viewForSession,
} from "./view-model";

const agent = (id: string, parentId: string | null): AgentRow => ({
	id,
	kind: "task",
	parentId,
	status: "running",
	activity: null,
	canMessage: true,
	queue: { steering: [], followUp: [] },
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
		expect(hashForLayout({ panes: [view], focus: 0, maximized: false })).toBe("#7c51f77b2a1bf7ba/Parent%2FChild%20%232");
		expect(hashForLayout({ panes: [view], focus: 0, maximized: false })).toBe(hashForView(view));
		expect(layoutFromHash("#7c51f77b2a1bf7ba/Parent%2FChild%20%232")).toEqual({ panes: [view], focus: 0, maximized: false });
		expect(layoutFromHash("#7c51f77b2a1bf7ba")).toEqual({ panes: [live("7c51f77b2a1bf7ba")], focus: 0, maximized: false });
		expect(layoutFromHash("")).toEqual({ panes: [], focus: 0, maximized: false });
		expect(hashForLayout({ panes: [], focus: 0, maximized: false })).toBe("");
	});

	test("a past session is not read as a subagent of an instance named `past`", () => {
		expect(hashForView(past("01a0f6a5-181e"))).toBe("#past/01a0f6a5-181e");
		expect(layoutFromHash("#past/01a0f6a5-181e")).toEqual({ panes: [past("01a0f6a5-181e")], focus: 0, maximized: false });
	});

	test("several panes round-trip in order with the focused one, ids with commas and @ included", () => {
		const layout: Layout = { panes: [live("a1"), live("a1", "x,y@z"), past("s,1"), live("b2")], focus: 2, maximized: false };
		const hash = hashForLayout(layout);
		expect(hash).toBe("#a1,a1/x%2Cy%40z,past/s%2C1,b2@2");
		expect(layoutFromHash(hash)).toEqual(layout);
		expect(hashForLayout({ panes: [live("a1"), live("b2")], focus: 0, maximized: false })).toBe("#a1,b2");
	});

	test("a maximized pane round-trips, ids with semicolons included", () => {
		const layout: Layout = { panes: [live("a1", "x;max"), live("b2")], focus: 1, maximized: true };
		expect(hashForLayout(layout)).toBe("#a1/x%3Bmax,b2@1;max");
		expect(layoutFromHash("#a1/x%3Bmax,b2@1;max")).toEqual(layout);
		expect(layoutFromHash("#a1/x%3Bmax,b2;max")).toEqual({ ...layout, focus: 0 });
	});

	test("a hash maximizing a lone pane opens it unmaximized", () => {
		expect(layoutFromHash("#a;max")).toEqual({ panes: [live("a")], focus: 0, maximized: false });
		expect(layoutFromHash("#a,a@1;max")).toEqual({ panes: [live("a")], focus: 0, maximized: false });
	});

	test("keeps the first four distinct views and focus on the view the hash named", () => {
		const layout = (panes: View[], focus: number): Layout => ({ panes, focus, maximized: false });
		expect(layoutFromHash("#a,b,c,d,e")).toEqual(layout([live("a"), live("b"), live("c"), live("d")], 0));
		expect(layoutFromHash("#a,b,a,c@2")).toEqual(layout([live("a"), live("b"), live("c")], 0));
		expect(layoutFromHash("#a,b,a,c@3")).toEqual(layout([live("a"), live("b"), live("c")], 2));
		expect(layoutFromHash("#a,b,c,d,e@4")).toEqual(layout([live("a"), live("b"), live("c"), live("d")], 0));
		expect(layoutFromHash("#a,b@9")).toEqual(layout([live("a"), live("b")], 0));
		expect(layoutFromHash("#a,b@x")).toEqual(layout([live("a"), live("b")], 0));
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

	test("the inbox hash opens the page alone or at one pull request's row, and no inbox hash is read as a layout", () => {
		const target = { owner: "acme", repo: "web.app", number: 6596 };
		expect(hashForInbox(null)).toBe("#inbox");
		expect(hashForInbox(target)).toBe("#inbox/acme/web.app/6596");
		expect(inboxFromHash("#inbox")).toEqual({ target: null });
		expect(inboxFromHash("#inbox/acme/web.app/6596")).toEqual({ target });
		expect(inboxFromHash("#inbox/acme/web.app")).toEqual({ target: null });
		expect(inboxFromHash("#7c51f77b2a1bf7ba")).toBeNull();
		for (const hash of ["#inbox", "#inbox/acme/web.app/6596", "#inbox/acme"]) expect(layoutFromHash(hash)).toBeNull();
	});

	test("a session link names the session by id and opens the host that runs it, else its saved transcript", () => {
		const hosts = [{ instanceId: "7c51f77b", sessionId: "01a0f6a5-181e" }] as RosterHost[];
		expect(sessionFromHash("#session/01a0f6a5-181e")).toBe("01a0f6a5-181e");
		expect(sessionFromHash("#past/01a0f6a5-181e")).toBeNull();
		expect(layoutFromHash("#session/01a0f6a5-181e")).toBeNull();
		expect(viewForSession("01a0f6a5-181e", hosts)).toEqual(live("7c51f77b"));
		expect(viewForSession("9d2e0000", hosts)).toEqual(past("9d2e0000"));
	});
});

describe("inbox sections", () => {
	const pr = (number: number, fields: Partial<InboxPullRequest>): InboxPullRequest => ({
		owner: "acme",
		repo: "webapp",
		number,
		title: `PR ${number}`,
		author: { login: "me", avatarUrl: null },
		reviewers: [],
		role: "author",
		state: "open",
		review: "review-required",
		checks: "passing",
		head: `me/branch-${number}`,
		stackedOn: null,
		unresolved: { count: 0, exact: true },
		updatedAt: number,
		...fields,
	});

	test("each PR lands in the first section that takes it, newest first, and empty sections drop out", () => {
		const sections = inboxSections([
			pr(1, { role: "reviewer", review: "changes-requested", author: { login: "teammate", avatarUrl: null } }),
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
	const split = (panes: View[], focus: number): Layout => ({ panes, focus, maximized: false });
	const maximized = (panes: View[], focus: number): Layout => ({ panes, focus, maximized: true });

	test("a plain open replaces the focused pane; a split adds a focused pane", () => {
		expect(openView(split([], 0), a, "split")).toEqual(split([a], 0));
		expect(openView(split([a, b], 1), c, "replace")).toEqual(split([a, c], 1));
		expect(openView(split([a, b], 0), c, "split")).toEqual(split([a, b, c], 2));
	});

	test("a split with four panes open replaces the focused one", () => {
		expect(openView(split([a, b, c, d], 1), e, "split")).toEqual(split([a, e, c, d], 1));
	});

	test("a view already open gets focus instead of a second pane", () => {
		expect(openView(split([a, b, c], 0), c, "split")).toEqual(split([a, b, c], 2));
		expect(openView(split([a, b, c], 0), b, "replace")).toEqual(split([a, b, c], 1));
	});

	test("a plain open keeps the pane maximized; a split brings the split back", () => {
		expect(openView(maximized([a, b], 1), c, "replace")).toEqual(maximized([a, c], 1));
		expect(openView(maximized([a, b, c], 0), c, "replace")).toEqual(maximized([a, b, c], 2));
		expect(openView(maximized([a, b], 1), c, "split")).toEqual(split([a, b, c], 2));
		expect(openView(maximized([a, b, c, d], 1), e, "split")).toEqual(split([a, e, c, d], 1));
		expect(openView(maximized([a, b, c], 0), c, "split")).toEqual(split([a, b, c], 2));
	});

	test("closing keeps focus on its view, or moves it to the pane taking the closed one's place", () => {
		expect(closePane(split([a, b, c], 2), 0)).toEqual(split([b, c], 1));
		expect(closePane(split([a, b, c], 1), 1)).toEqual(split([a, c], 1));
		expect(closePane(split([a, b, c], 2), 2)).toEqual(split([a, b], 1));
		expect(closePane(split([a, b], 0), 1)).toEqual(split([a], 0));
		expect(closePane(split([a], 0), 0)).toEqual(split([], 0));
	});

	test("closing the maximized pane, or all but one, brings the split back", () => {
		expect(closePane(maximized([a, b, c], 1), 1)).toEqual(split([a, c], 1));
		expect(closePane(maximized([a, b, c], 2), 0)).toEqual(maximized([b, c], 1));
		expect(closePane(maximized([a, b], 0), 1)).toEqual(split([a], 0));
	});
});

describe("defaultCwd", () => {
	const host = (instanceId: string, cwdDisplay: string, startedAt: number) => ({ instanceId, cwd: cwdDisplay, cwdDisplay, startedAt }) as RosterHost;
	const past = (sessionId: string, cwdDisplay: string) => ({ sessionId, cwd: cwdDisplay, cwdDisplay }) as PastSession;
	const hosts = [host("a", "~/old", 1), host("b", "~/new", 2)];
	const sessions = [past("s1", ""), past("s2", "~/saved")];

	test("prefers the open session, then the newest live one, then the newest past one with a directory", () => {
		expect(defaultCwd({ kind: "live", instanceId: "a", agentId: null }, hosts, sessions, null)).toBe("~/old");
		expect(defaultCwd({ kind: "past", sessionId: "s2" }, hosts, sessions, null)).toBe("~/saved");
		expect(defaultCwd(null, hosts, sessions, null)).toBe("~/new");
		expect(defaultCwd({ kind: "past", sessionId: "s1" }, [], sessions, null)).toBe("~/saved");
		expect(defaultCwd(null, [], [], null)).toBe("~");
	});

	test("stays in the selected project, so the new session is listed under it", () => {
		expect(defaultCwd({ kind: "live", instanceId: "b", agentId: null }, hosts, sessions, "~/old")).toBe("~/old");
		expect(defaultCwd(null, hosts, sessions, "~/saved")).toBe("~/saved");
	});
});

describe("matchesFilter", () => {
	const session = {
		sessionId: "s1",
		title: "Fix all outstanding problems",
		cwd: "/Users/me/code/webapp",
		cwdDisplay: "~/code/webapp",
		modifiedAt: 0,
		pullRequests: [{ owner: "acme", repo: "webapp", number: 6596, link: "worked" }],
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
