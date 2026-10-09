import { describe, expect, test } from "bun:test";
import { hashForSession, type RosterHost, type View } from "../src/shared/sessions";
import type { StartOp } from "./starts";
import {
	adjacentSession,
	closePane,
	endSession,
	hashForChanges,
	hashForInbox,
	hashForLayout,
	hashForNewSession,
	hashForPullRequestFiles,
	hashForRoutines,
	hashForSettings,
	hashForTickets,
	hashForTodo,
	hashForView,
	type Layout,
	layoutAfterResumeAll,
	layoutAfterStart,
	openView,
	type Page,
	type Route,
	routeFromHash,
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
		expect(routeFromHash("#7c51f77b2a1bf7ba/Parent%2FChild%20%232")).toEqual({ kind: "panes", layout: { panes: [view], focus: 0, maximized: false } });
		expect(routeFromHash("#7c51f77b2a1bf7ba")).toEqual({ kind: "panes", layout: { panes: [live("7c51f77b2a1bf7ba")], focus: 0, maximized: false } });
		expect(routeFromHash("")).toEqual({ kind: "panes", layout: { panes: [], focus: 0, maximized: false } });
		expect(hashForLayout({ panes: [], focus: 0, maximized: false })).toBe("");
	});

	test("a past session is not read as a subagent of an instance named `past`", () => {
		expect(hashForView(past("01a0f6a5-181e"))).toBe("#past/01a0f6a5-181e");
		expect(routeFromHash("#past/01a0f6a5-181e")).toEqual({ kind: "panes", layout: { panes: [past("01a0f6a5-181e")], focus: 0, maximized: false } });
	});

	test("several panes round-trip in order with the focused one, ids with commas and @ included", () => {
		const layout: Layout = { panes: [live("a1"), live("a1", "x,y@z"), past("s,1"), live("b2")], focus: 2, maximized: false };
		const hash = hashForLayout(layout);
		expect(hash).toBe("#a1,a1/x%2Cy%40z,past/s%2C1,b2@2");
		expect(routeFromHash(hash)).toEqual({ kind: "panes", layout });
		expect(hashForLayout({ panes: [live("a1"), live("b2")], focus: 0, maximized: false })).toBe("#a1,b2");
	});

	test("a maximized pane round-trips, ids with semicolons included", () => {
		const layout: Layout = { panes: [live("a1", "x;max"), live("b2")], focus: 1, maximized: true };
		expect(hashForLayout(layout)).toBe("#a1/x%3Bmax,b2@1;max");
		expect(routeFromHash("#a1/x%3Bmax,b2@1;max")).toEqual({ kind: "panes", layout });
		expect(routeFromHash("#a1/x%3Bmax,b2;max")).toEqual({ kind: "panes", layout: { ...layout, focus: 0 } });
	});

	test("a hash maximizing a lone pane opens it unmaximized", () => {
		expect(routeFromHash("#a;max")).toEqual({ kind: "panes", layout: { panes: [live("a")], focus: 0, maximized: false } });
		expect(routeFromHash("#a,a@1;max")).toEqual({ kind: "panes", layout: { panes: [live("a")], focus: 0, maximized: false } });
	});

	test("keeps the first four distinct views and focus on the view the hash named", () => {
		const layout = (panes: View[], focus: number): Layout => ({ panes, focus, maximized: false });
		expect(routeFromHash("#a,b,c,d,e")).toEqual({ kind: "panes", layout: layout([live("a"), live("b"), live("c"), live("d")], 0) });
		expect(routeFromHash("#a,b,a,c@2")).toEqual({ kind: "panes", layout: layout([live("a"), live("b"), live("c")], 0) });
		expect(routeFromHash("#a,b,a,c@3")).toEqual({ kind: "panes", layout: layout([live("a"), live("b"), live("c")], 2) });
		expect(routeFromHash("#a,b,c,d,e@4")).toEqual({ kind: "panes", layout: layout([live("a"), live("b"), live("c"), live("d")], 0) });
		expect(routeFromHash("#a,b@9")).toEqual({ kind: "panes", layout: layout([live("a"), live("b")], 0) });
		expect(routeFromHash("#a,b@x")).toEqual({ kind: "panes", layout: layout([live("a"), live("b")], 0) });
	});

	test("the settings page names its section, its workspace keeps its slashes, and an unknown section opens Analytics", () => {
		const hash = hashForSettings("models", "/Users/me/code/my app");
		expect(hash).toBe("#settings/models/%2FUsers%2Fme%2Fcode%2Fmy%20app");
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "settings", section: "models", cwd: "/Users/me/code/my app" } });
		expect(routeFromHash("#settings/integrations")).toEqual({ kind: "page", page: { kind: "settings", section: "integrations", cwd: null } });
		expect(routeFromHash("#settings")).toEqual({ kind: "page", page: { kind: "settings", section: "analytics", cwd: null } });
		expect(routeFromHash("#settings/%2Fw")).toEqual({ kind: "page", page: { kind: "settings", section: "analytics", cwd: null } });
		expect(routeFromHash("#7c51f77b2a1bf7ba").kind).toBe("panes");
	});

	test("the new-session draft is not read as a layout, and its directory keeps its slashes and tilde", () => {
		const hash = hashForNewSession("~/code/my app");
		expect(hash).toBe("#new/~%2Fcode%2Fmy%20app");
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "new", cwd: "~/code/my app", todoId: null } });
		expect(routeFromHash("#new")).toEqual({ kind: "page", page: { kind: "new", cwd: null, todoId: null } });
		expect(routeFromHash("#newer").kind).toBe("panes");
		expect(routeFromHash("#7c51f77b2a1bf7ba").kind).toBe("panes");
	});

	test("a draft for a todo names it after the directory, or alone", () => {
		expect(hashForNewSession("~/code", "t 1")).toBe("#new/~%2Fcode?todo=t%201");
		expect(routeFromHash("#new/~%2Fcode?todo=t%201")).toEqual({ kind: "page", page: { kind: "new", cwd: "~/code", todoId: "t 1" } });
		expect(hashForNewSession(null, "t1")).toBe("#new?todo=t1");
		expect(routeFromHash("#new?todo=t1")).toEqual({ kind: "page", page: { kind: "new", cwd: null, todoId: "t1" } });
	});

	test("the inbox hash opens the page alone or at one pull request's row, and no inbox hash is read as a layout", () => {
		const target = { owner: "acme", repo: "web.app", number: 6596 };
		expect(hashForInbox(null)).toBe("#inbox");
		expect(hashForInbox(target)).toBe("#inbox/acme/web.app/6596");
		expect(routeFromHash("#inbox")).toEqual({ kind: "page", page: { kind: "inbox", target: null } });
		expect(routeFromHash("#inbox/acme/web.app/6596")).toEqual({ kind: "page", page: { kind: "inbox", target, files: null } });
		expect(routeFromHash("#inbox/acme/web.app")).toEqual({ kind: "page", page: { kind: "inbox", target: null } });
		expect(routeFromHash("#7c51f77b2a1bf7ba").kind).toBe("panes");
		for (const hash of ["#inbox", "#inbox/acme/web.app/6596", "#inbox/acme"]) expect(routeFromHash(hash).kind).toBe("page");
	});

	test("the inbox files hash opens a pull request's first changed file or one by path, slashes, spaces, and brackets kept", () => {
		const target = { owner: "acme", repo: "web.app", number: 6596 };
		expect(hashForPullRequestFiles(target)).toBe("#inbox/acme/web.app/6596/files");
		expect(routeFromHash("#inbox/acme/web.app/6596/files")).toEqual({ kind: "page", page: { kind: "inbox", target, files: { path: null } } });
		expect(hashForPullRequestFiles(target, "app/[id]/page view.tsx")).toBe("#inbox/acme/web.app/6596/files/app%2F%5Bid%5D%2Fpage%20view.tsx");
		for (const path of ["app/[id]/page view.tsx", "README.md"]) {
			expect(routeFromHash(hashForPullRequestFiles(target, path))).toEqual({ kind: "page", page: { kind: "inbox", target, files: { path } } });
		}
		expect(routeFromHash("#inbox/acme/web.app/6596/filesx")).toEqual({ kind: "page", page: { kind: "inbox", target: null } });
	});

	test("the tickets hash opens the list or one issue's details, and no tickets hash is read as a layout", () => {
		expect(hashForTickets(null)).toBe("#tickets");
		expect(hashForTickets("ENG-2368")).toBe("#tickets/ENG-2368");
		expect(routeFromHash("#tickets")).toEqual({ kind: "page", page: { kind: "tickets", target: null } });
		expect(routeFromHash("#tickets/ENG-2368")).toEqual({ kind: "page", page: { kind: "tickets", target: "ENG-2368" } });
		expect(routeFromHash("#tickets/not-an-issue")).toEqual({ kind: "page", page: { kind: "tickets", target: null } });
		expect(routeFromHash("#ticketsx").kind).toBe("panes");
		expect(routeFromHash("#7c51f77b2a1bf7ba").kind).toBe("panes");
		for (const hash of ["#tickets", "#tickets/ENG-2368", "#tickets/x"]) expect(routeFromHash(hash).kind).toBe("page");
	});

	test("the todo hash opens every todo, a list that is not a category, or one category's, and no todo hash is read as a layout", () => {
		expect(hashForTodo({ kind: "all" })).toBe("#todo");
		expect(hashForTodo({ kind: "category", id: "a b/c" })).toBe("#todo/a%20b%2Fc");
		expect(routeFromHash("#todo")).toEqual({ kind: "page", page: { kind: "todo", list: { kind: "all" } } });
		expect(routeFromHash("#todo/a%20b%2Fc")).toEqual({ kind: "page", page: { kind: "todo", list: { kind: "category", id: "a b/c" } } });
		expect(routeFromHash("#todo/")).toEqual({ kind: "page", page: { kind: "todo", list: { kind: "all" } } });
		for (const kind of ["today", "agents", "archive"] as const) {
			expect(hashForTodo({ kind })).toBe(`#todo/${kind}`);
			expect(routeFromHash(`#todo/${kind}`)).toEqual({ kind: "page", page: { kind: "todo", list: { kind } } });
		}
		for (const hash of ["#todo", "#todo/0b9e"]) expect(routeFromHash(hash).kind).toBe("page");
	});

	test("the routines hash opens the list or one routine, and no routines hash is read as a layout", () => {
		const id = "3f2a9c1e-7b4d-4e8a-9f61-0c2d5e8b7a14";
		expect(hashForRoutines(null)).toBe("#routines");
		expect(hashForRoutines(id)).toBe(`#routines/${id}`);
		expect(routeFromHash("#routines")).toEqual({ kind: "page", page: { kind: "routines", target: null } });
		expect(routeFromHash(`#routines/${id}`)).toEqual({ kind: "page", page: { kind: "routines", target: id } });
		expect(routeFromHash("#routines/")).toEqual({ kind: "page", page: { kind: "routines", target: null } });
		expect(routeFromHash("#routinesx").kind).toBe("panes");
	});

	test("the changes hash opens a session's first file or one by path, slashes and absolute paths kept, and is not read as a layout", () => {
		expect(hashForChanges("01a0f6a5-181e")).toBe("#changes/01a0f6a5-181e");
		expect(routeFromHash("#changes/01a0f6a5-181e")).toEqual({ kind: "page", page: { kind: "changes", sessionId: "01a0f6a5-181e", path: null } });
		for (const path of ["web/components/a b.tsx", "~/.omp/agent/AGENTS.md"]) {
			expect(routeFromHash(hashForChanges("01a0f6a5-181e", path))).toEqual({ kind: "page", page: { kind: "changes", sessionId: "01a0f6a5-181e", path } });
		}
		expect(routeFromHash("#changesx").kind).toBe("panes");
	});

	test("every page hash names its page and route, and a session or layout hash names none", () => {
		expect(routeFromHash(hashForSettings("files", "/work/app"))).toEqual({ kind: "page", page: { kind: "settings", section: "files", cwd: "/work/app" } });
		expect(routeFromHash(hashForInbox(null))).toEqual({ kind: "page", page: { kind: "inbox", target: null } });
		expect(routeFromHash(hashForNewSession(null))).toEqual({ kind: "page", page: { kind: "new", cwd: null, todoId: null } });
		expect(routeFromHash("#session/01a0f6a5-181e")).toEqual({ kind: "session", sessionId: "01a0f6a5-181e" });
		expect(routeFromHash("#7c51f77b2a1bf7ba,past/9d2e0000").kind).toBe("panes");
	});

	test("a session link names the session by id and opens the host that runs it, else its saved transcript", () => {
		const hosts = [{ instanceId: "7c51f77b", sessionId: "01a0f6a5-181e" }] as RosterHost[];
		expect(routeFromHash("#session/01a0f6a5-181e")).toEqual({ kind: "session", sessionId: "01a0f6a5-181e" });
		expect(routeFromHash("#past/01a0f6a5-181e").kind).toBe("panes");
		expect(viewForSession("01a0f6a5-181e", hosts)).toEqual(live("7c51f77b"));
		expect(viewForSession("9d2e0000", hosts)).toEqual(past("9d2e0000"));
	});

	test("a malformed percent-escape names nothing instead of throwing: the page opens without its target, and its pane drops", () => {
		const page = (page: Page): Route => ({ kind: "page", page });
		expect(routeFromHash("#todo/%E0")).toEqual(page({ kind: "todo", list: { kind: "all" } }));
		expect(routeFromHash("#routines/%zz")).toEqual(page({ kind: "routines", target: null }));
		expect(routeFromHash("#settings/models/%E0")).toEqual(page({ kind: "settings", section: "models", cwd: null }));
		expect(routeFromHash("#new/%E0?todo=t1")).toEqual(page({ kind: "new", cwd: null, todoId: "t1" }));
		expect(routeFromHash("#inbox/acme/web/1/files/%E0")).toEqual(page({ kind: "inbox", target: { owner: "acme", repo: "web", number: 1 }, files: { path: null } }));
		expect(routeFromHash("#changes/s1/%E0")).toEqual(page({ kind: "changes", sessionId: "s1", path: null }));
		expect(routeFromHash("#session/%E0")).toEqual({ kind: "panes", layout: { panes: [], focus: 0, maximized: false } });
		expect(routeFromHash("#a,past/%zz,b/%E0,c@1")).toEqual({ kind: "panes", layout: { panes: [live("a"), live("c")], focus: 1, maximized: false } });
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

	test("a started session opens where its start asked: a resume in its transcript's pane, a quick action nowhere", () => {
		const past: View = { kind: "past", sessionId: "s" };
		const layout = split([a, past, b], 2);
		const quick: StartOp = { kind: "quick", cwd: "/tmp", prompt: "fix", subject: { kind: "ticket", id: "ENG-7", action: "work" }, skill: null };
		expect(layoutAfterStart(layout, { kind: "resume", sessionId: "s" }, "c")).toEqual(split([a, c, b], 1));
		expect(layoutAfterStart(layout, { kind: "fork", view: a, itemId: "u1", point: { entryId: "e1", prefill: true } }, "c")).toEqual(split([a, past, c], 2));
		expect(layoutAfterStart(layout, quick, "c")).toBeNull();
		expect(layoutAfterStart(layout, { kind: "resume-all", sessionIds: ["s"] }, "c")).toBeNull();
	});

	test("a Resume all shows each resumed session live in the pane of its transcript, and leaves the panes otherwise", () => {
		const [s1, s2]: View[] = [{ kind: "past", sessionId: "s1" }, { kind: "past", sessionId: "s2" }];
		const started = [{ sessionId: "s2", instanceId: "c" }];
		expect(layoutAfterResumeAll(split([s1, a, s2], 0), started)).toEqual(split([s1, a, c], 0));
		expect(layoutAfterResumeAll(split([s1, a], 1), started)).toBeNull();
	});

	test("ending a session shows the next listed session in its pane, else the previous, skipping open ones", () => {
		const listed = ["a", "b", "c", "d"];
		const eligible = new Set(listed);
		expect(endSession(split([b], 0), "b", listed, eligible)).toEqual(split([c], 0));
		expect(endSession(split([d], 0), "d", listed, eligible)).toEqual(split([c], 0));
		expect(endSession(maximized([b, c], 0), "b", listed, eligible)).toEqual(maximized([d, c], 0));
		expect(endSession(split([a, d, c], 1), "d", listed, eligible)).toEqual(split([a, b, c], 1));
	});

	test("each pane of the ended session, its subagents included, takes its own neighbor while any are left, and the rest close", () => {
		const subagent: View = { kind: "live", instanceId: "b", agentId: "x" };
		expect(endSession(split([b, subagent], 1), "b", ["a", "b", "c"], new Set(["a", "c"]))).toEqual(split([c, a], 1));
		expect(endSession(split([b, subagent], 1), "b", ["b", "c"], new Set(["c"]))).toEqual(split([c], 0));
		expect(endSession(maximized([subagent, a, b], 0), "b", ["a", "b"], new Set(["a"]))).toEqual(split([a], 0));
	});

	test("ending a session with no other listed session, or one the sidebar leaves out, closes its panes", () => {
		expect(endSession(split([a], 0), "a", ["a"], new Set())).toEqual(split([], 0));
		expect(endSession(split([a, b], 0), "a", ["a", "b"], new Set(["b"]))).toEqual(split([b], 0));
		expect(endSession(split([c, a], 0), "a", ["b", "c"], new Set(["b", "c"]))).toEqual(split([c], 0));
	});

	test("ending keeps its original anchor but skips neighbors that exited or are also ending", () => {
		const listedBeforeEnd = ["a", "b", "c", "d"];
		expect(endSession(split([a], 0), "a", listedBeforeEnd, new Set(["c", "d"]))).toEqual(split([c], 0));
		expect(endSession(split([d], 0), "d", listedBeforeEnd, new Set(["a", "b"]))).toEqual(split([b], 0));
		const afterB = endSession(split([a], 0), "b", listedBeforeEnd, new Set(["c", "d"]));
		expect(endSession(afterB, "a", listedBeforeEnd, new Set(["c", "d"]))).toEqual(split([c], 0));
		expect(endSession(split([a], 0), "a", listedBeforeEnd, new Set())).toEqual(split([], 0));
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

describe("session links", () => {
	test("the link a pull request's description carries opens the session it names", () => {
		const sessionId = "01a0f6a5-181e/#x y";
		expect(routeFromHash(hashForSession(sessionId))).toEqual({ kind: "session", sessionId });
	});
});
