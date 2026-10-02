import { describe, expect, test } from "bun:test";
import type { RosterHost, View } from "../src/shared";
import {
	adjacentSession,
	closePane,
	endSession,
	hashForInbox,
	hashForLayout,
	hashForNewSession,
	hashForSettings,
	hashForTickets,
	hashForView,
	inboxFromHash,
	type Layout,
	layoutFromHash,
	newSessionFromHash,
	openView,
	pageFromHash,
	sessionFromHash,
	settingsFromHash,
	swapView,
	viewForSession,
} from "./routing";

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

	test("the new-session draft is not read as a layout, and its directory keeps its slashes and tilde", () => {
		const hash = hashForNewSession("~/code/my app");
		expect(hash).toBe("#new/~%2Fcode%2Fmy%20app");
		expect(newSessionFromHash(hash)).toEqual({ cwd: "~/code/my app" });
		expect(layoutFromHash(hash)).toBeNull();
		expect(newSessionFromHash("#new")).toEqual({ cwd: null });
		expect(layoutFromHash("#new")).toBeNull();
		expect(newSessionFromHash("#newer")).toBeNull();
		expect(newSessionFromHash("#7c51f77b2a1bf7ba")).toBeNull();
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

	test("the tickets hash opens the page alone or at one issue's row, and no tickets hash is read as a layout", () => {
		expect(hashForTickets(null)).toBe("#tickets");
		expect(hashForTickets("ENG-2368")).toBe("#tickets/ENG-2368");
		expect(pageFromHash("#tickets")).toEqual({ kind: "tickets", target: null });
		expect(pageFromHash("#tickets/ENG-2368")).toEqual({ kind: "tickets", target: "ENG-2368" });
		expect(pageFromHash("#tickets/not-an-issue")).toEqual({ kind: "tickets", target: null });
		expect(pageFromHash("#ticketsx")).toBeNull();
		expect(pageFromHash("#7c51f77b2a1bf7ba")).toBeNull();
		for (const hash of ["#tickets", "#tickets/ENG-2368", "#tickets/x"]) expect(layoutFromHash(hash)).toBeNull();
	});

	test("every page hash names its page and route, and a session or layout hash names none", () => {
		expect(pageFromHash(hashForSettings("/work/app"))).toEqual({ kind: "settings", cwd: "/work/app" });
		expect(pageFromHash(hashForInbox(null))).toEqual({ kind: "inbox", target: null });
		expect(pageFromHash(hashForNewSession(null))).toEqual({ kind: "new", cwd: null });
		expect(pageFromHash("#session/01a0f6a5-181e")).toBeNull();
		expect(pageFromHash("#7c51f77b2a1bf7ba,past/9d2e0000")).toBeNull();
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

	test("a resumed session takes the pane of its transcript, else the focused pane", () => {
		const past: View = { kind: "past", sessionId: "s" };
		expect(swapView(split([a, past, b], 2), past, c)).toEqual(split([a, c, b], 1));
		expect(swapView(split([a, b], 1), past, c)).toEqual(split([a, c], 1));
	});

	test("ending a session shows the next listed session in its pane, else the previous, skipping open ones", () => {
		const listed = ["a", "b", "c", "d"];
		expect(endSession(split([b], 0), "b", listed)).toEqual(split([c], 0));
		expect(endSession(split([d], 0), "d", listed)).toEqual(split([c], 0));
		expect(endSession(maximized([b, c], 0), "b", listed)).toEqual(maximized([d, c], 0));
		expect(endSession(split([a, d, c], 1), "d", listed)).toEqual(split([a, b, c], 1));
	});

	test("each pane of the ended session, its subagents included, takes its own neighbor while any are left", () => {
		const subagent: View = { kind: "live", instanceId: "b", agentId: "x" };
		expect(endSession(split([b, subagent], 1), "b", ["a", "b", "c"])).toEqual(split([c, a], 1));
		expect(endSession(split([b, subagent], 1), "b", ["b", "c"])).toEqual(split([c, subagent], 1));
	});

	test("ending a session with no other listed session, or one the sidebar leaves out, keeps its pane", () => {
		expect(endSession(split([a], 0), "a", ["a"])).toEqual(split([a], 0));
		expect(endSession(split([a, b], 0), "a", ["a", "b"])).toEqual(split([a, b], 0));
		expect(endSession(split([a], 0), "a", ["b", "c"])).toEqual(split([a], 0));
	});
});

describe("stepping through the sidebar's sessions", () => {
	const a: View = { kind: "live", instanceId: "a", agentId: null };
	const b: View = { kind: "live", instanceId: "b", agentId: null };
	const old: View = { kind: "past", sessionId: "old" };
	const listed = [a, b, old];

	test("steps to the neighboring row, from running into past sessions, and stops at either end", () => {
		expect(adjacentSession(listed, b, 1)).toEqual(old);
		expect(adjacentSession(listed, b, -1)).toEqual(a);
		expect(adjacentSession(listed, old, 1)).toBe(null);
		expect(adjacentSession(listed, a, -1)).toBe(null);
	});

	test("a subagent steps from its session's row", () => {
		expect(adjacentSession(listed, { kind: "live", instanceId: "a", agentId: "x" }, 1)).toEqual(b);
	});

	test("from a view the sidebar does not list, or none, steps onto the first or last row", () => {
		const elsewhere: View = { kind: "live", instanceId: "other project", agentId: null };
		expect(adjacentSession(listed, elsewhere, 1)).toEqual(a);
		expect(adjacentSession(listed, null, -1)).toEqual(old);
		expect(adjacentSession([], null, 1)).toBe(null);
	});
});
