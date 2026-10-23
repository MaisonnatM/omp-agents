import { describe, expect, test } from "bun:test";
import type { AgentRow, LiveView, RosterHost, View } from "../src/shared/sessions";
import { type DashboardState, initialState, reduce } from "./dashboard-state";
import type { PaneCommand } from "./pane-navigation";
import { hashForLayout, layoutAfterResumeAll, layoutAfterStart, routeFromHash } from "./routing";

function host(instanceId: string, sessionId = `session-${instanceId}`, agents: AgentRow[] = []): RosterHost {
	return {
		instanceId, sessionId, agents, source: "dashboard", cwd: "/work", cwdDisplay: "/work", pid: 1,
		sessionName: null, model: null, thinkingLevel: null, context: null, startedAt: 0, status: "idle",
		control: { phase: "live", readOnly: false }, requests: [], queue: { steering: [], followUp: [] },
		unread: null, thinkingLevels: [], switching: false, fast: null, pullRequests: [], tickets: [], ship: null,
		worktree: null, branch: null,
	};
}

const live = (instanceId: string, agentId: string | null = null): LiveView => ({ kind: "live", instanceId, agentId });
const past = (sessionId: string): View => ({ kind: "past", sessionId });

function roster(state: DashboardState, hosts: RosterHost[]): DashboardState {
	return reduce(state, { t: "roster", reset: true, hosts, removed: [], error: null });
}

function setup(hash = "#a,b@1", hosts = [host("a"), host("b"), host("c"), host("d"), host("e")]): DashboardState {
	return roster(initialState(routeFromHash(hash), { columns: 0.62, rows: 0.37 }), hosts);
}

const command = (state: DashboardState, command: PaneCommand): DashboardState => reduce(state, { t: "panes", command });
const select = (state: DashboardState, view: View, mode: "replace" | "split" = "replace"): DashboardState => command(state, { kind: "select", view, mode });

function observe(state: DashboardState) {
	return { hash: hashForLayout(state.layout), ratios: state.splitRatios };
}

describe("session selection and split memory", () => {
	test("leaving an unequal split opens a single session and either member restores its order, focus, and geometry", () => {
		const single = select(setup("#a,b@1;max"), live("c"));
		expect(observe(single)).toEqual({ hash: "#c", ratios: { columns: 0.62, rows: 0.37 } });
		expect(single.layout).toEqual({ panes: [live("c")], focus: 0, maximized: false });
		expect(observe(select(single, live("a")))).toEqual({ hash: "#a,b", ratios: { columns: 0.62, rows: 0.37 } });
		expect(observe(select(single, live("b")))).toEqual({ hash: "#a,b@1", ratios: { columns: 0.62, rows: 0.37 } });
	});

	test("selecting a visible member only focuses its pane and reveals a maximized split", () => {
		const state = select(setup("#a,b;max"), live("b"));
		expect(state.layout).toEqual({ panes: [live("a"), live("b")], focus: 1, maximized: false });
	});

	test("each disjoint group retains both divider ratios while another group resizes", () => {
		let state = select(setup(), live("c"));
		state = select(state, live("d"), "split");
		state = command(state, { kind: "resize", axis: "columns", ratio: 0.43 });
		state = command(state, { kind: "resize", axis: "rows", ratio: 0.71 });
		expect(observe(select(state, live("a")))).toEqual({ hash: "#a,b", ratios: { columns: 0.62, rows: 0.37 } });
		state = command(select(state, live("a")), { kind: "resize", axis: "columns", ratio: 0.68 });
		expect(observe(select(state, live("d")))).toEqual({ hash: "#c,d@1", ratios: { columns: 0.43, rows: 0.71 } });
		expect(observe(select(select(state, live("d")), live("b")))).toEqual({ hash: "#a,b@1", ratios: { columns: 0.68, rows: 0.37 } });
	});

	test("an overlapping explicit split retires the entire old group", () => {
		let state = select(setup(), live("c"));
		state = select(state, live("a"), "split");
		expect(hashForLayout(state.layout)).toBe("#c,a@1");
		state = select(state, live("b"));
		expect(hashForLayout(state.layout)).toBe("#b");
		expect(hashForLayout(select(state, live("a")).layout)).toBe("#c,a@1");
	});

	test("explicit splits add panes up to four and then replace only the focused pane", () => {
		let state = select(setup(), live("c"), "split");
		state = select(state, live("d"), "split");
		expect(hashForLayout(state.layout)).toBe("#a,b,c,d@3");
		state = reduce(state, { t: "panes", command: { kind: "edit", layout: { ...state.layout, focus: 1, maximized: true } }, replace: true });
		state = select(state, live("e"), "split");
		expect(state.layout).toEqual({ panes: [live("a"), live("e"), live("c"), live("d")], focus: 1, maximized: false });
	});

	test("fork and replay keep explicit pane-edit behavior instead of ordinary session selection", () => {
		const state = setup("#a,b@1;max");
		const fork = layoutAfterStart(state.layout, { kind: "fork", view: live("a"), itemId: "prompt", point: { entryId: "entry", prefill: true } }, "fork");
		if (!fork) throw new Error("A fork must open a pane");
		expect(hashForLayout(command(state, { kind: "edit", layout: fork }).layout)).toBe("#a,fork@1;max");
		const replay = layoutAfterStart(state.layout, { kind: "replay", view: live("a"), turnId: "turn", token: "token", model: null, thinking: null, prompt: null }, "replay");
		if (!replay) throw new Error("A replay must open beside its source");
		expect(hashForLayout(command(state, { kind: "edit", layout: replay }).layout)).toBe("#a,b,replay@2");
	});

	test("closing B from AB prevents a later selection of A from reviving B", () => {
		const closed = command(setup(), { kind: "close", index: 1 });
		expect(hashForLayout(closed.layout)).toBe("#a");
		expect(hashForLayout(select(select(closed, live("c")), live("a")).layout)).toBe("#a");
	});

	test("closing a disconnected member still invalidates its remembered source", () => {
		const disconnected = roster(setup(), [host("a"), host("c")]);
		const closed = command(disconnected, { kind: "close", index: 1 });
		expect(hashForLayout(closed.layout)).toBe("#a");
		expect(hashForLayout(select(select(closed, live("c")), live("a")).layout)).toBe("#a");
	});

	test("closing the final pane stays empty until an explicit selection", () => {
		const single = command(setup(), { kind: "close", index: 1 });
		const empty = command(single, { kind: "close", index: 0 });
		expect(empty.layout).toEqual({ panes: [], focus: 0, maximized: false });
		expect(hashForLayout(select(empty, live("a")).layout)).toBe("#a");
	});

	test("closing one of three panes remembers the surviving pair instead of the outgoing triple", () => {
		const closed = command(setup("#a,b,c@2;max"), { kind: "close", index: 1 });
		expect(hashForLayout(closed.layout)).toBe("#a,c@1;max");
		const away = select(closed, live("d"));
		expect(hashForLayout(select(away, live("c")).layout)).toBe("#a,c@1");
		expect(hashForLayout(select(away, live("b")).layout)).toBe("#b");
	});

	test("an ended root resolves as past even before the past-list update, then resumes in its new instance", () => {
		let state = select(setup(), live("c"));
		state = roster(state, [host("b"), host("c")]);
		state = select(state, past("session-a"));
		expect(hashForLayout(state.layout)).toBe("#past/session-a,b");
		state = select(state, live("c"));
		state = roster(state, [host("resumed", "session-a"), host("b"), host("c")]);
		expect(observe(select(state, live("b")))).toEqual({ hash: "#resumed,b@1", ratios: { columns: 0.62, rows: 0.37 } });
	});

	test("an instance reused by new does not bind the old conversation's memory to the new session", () => {
		let state = setup();
		state = roster(state, [host("a", "new-session"), host("b"), host("c")]);
		state = select(state, live("c"));
		expect(hashForLayout(select(state, live("a")).layout)).toBe("#a");
		expect(hashForLayout(select(state, past("session-a")).layout)).toBe("#past/session-a,b");
	});

	test("an expired subagent invalidates the whole group instead of resurrecting its raw view", () => {
		const agent: AgentRow = { id: "worker", kind: "task", parentId: null, status: "idle", activity: null, canMessage: true, queue: { steering: [], followUp: [] } };
		let state = setup("#a/worker,b", [host("a", "session-a", [agent]), host("b"), host("c")]);
		state = select(state, live("c"));
		state = roster(state, [host("a"), host("b"), host("c")]);
		expect(hashForLayout(select(state, live("b")).layout)).toBe("#b");
		const active = roster(setup("#a/worker,b", [host("a", "session-a", [agent]), host("b")]), [host("a"), host("b")]);
		expect(hashForLayout(select(active, live("b")).layout)).toBe("#b");
	});

	test("a resumed source resolves its subagent against the current instance", () => {
		const agent: AgentRow = { id: "worker", kind: "task", parentId: null, status: "running", activity: null, canMessage: true, queue: { steering: [], followUp: [] } };
		let state = select(setup("#a/worker,b", [host("a", "session-a", [agent]), host("b"), host("c")]), live("c"));
		state = roster(state, [host("new-a", "session-a", [agent]), host("b"), host("c")]);
		expect(hashForLayout(select(state, live("b")).layout)).toBe("#new-a/worker,b@1");
	});
});

describe("explicit history and startup", () => {
	test("Back can reopen a closed split exactly, and Forward to a single member stays single", () => {
		let state = command(setup(), { kind: "close", index: 1 });
		state = reduce(state, { t: "route", route: routeFromHash("#b,a@1;max") });
		expect(hashForLayout(state.layout)).toBe("#b,a@1;max");
		expect(state.historyWrite).toBeNull();
		state = reduce(state, { t: "route", route: routeFromHash("#a") });
		expect(hashForLayout(state.layout)).toBe("#a");
		expect(state.historyWrite).toBeNull();
		state = select(state, live("c"));
		expect(hashForLayout(select(state, live("a")).layout)).toBe("#b,a@1");
	});

	test("history uses a known group's geometry without changing the requested order, focus, or maximum", () => {
		let state = select(setup(), live("c"));
		state = select(state, live("d"), "split");
		state = command(state, { kind: "resize", axis: "columns", ratio: 0.41 });
		state = reduce(state, { t: "route", route: routeFromHash("#a,b@1;max") });
		expect(observe(state)).toEqual({ hash: "#a,b@1;max", ratios: { columns: 0.62, rows: 0.37 } });
		const repeated = reduce(state, { t: "route", route: routeFromHash("#a,b@1;max") });
		expect(repeated).toBe(state);
	});

	test("an explicit history split retires a newer overlapping group", () => {
		let state = select(select(setup(), live("c")), live("a"), "split");
		state = reduce(state, { t: "route", route: routeFromHash("#a,b@1") });
		expect(hashForLayout(state.layout)).toBe("#a,b@1");
		state = select(state, live("d"));
		expect(hashForLayout(select(state, live("c")).layout)).toBe("#c");
		expect(hashForLayout(select(state, live("b")).layout)).toBe("#a,b@1");
	});

	test("selection pushes, focus replaces, and identical navigation adds no history entry", () => {
		const single = select(setup(), live("c"));
		expect(single.historyWrite).toEqual({ revision: 1, hash: "#c", mode: "push" });
		const restored = select(single, live("a"));
		const focused = reduce(restored, { t: "panes", command: { kind: "edit", layout: { ...restored.layout, focus: 1 } }, replace: true });
		expect(focused.historyWrite).toEqual({ revision: 3, hash: "#a,b@1", mode: "replace" });
		expect(select(focused, live("b")).historyRevision).toBe(3);
		const page = reduce(focused, { t: "navigate", page: { kind: "settings", section: "preferences" } });
		expect(page.historyWrite).toEqual({ revision: 4, hash: "#settings/preferences", mode: "push" });
		expect(page.layout).toBe(focused.layout);
	});

	test("empty startup stays empty after session facts arrive", () => {
		const state = setup("");
		expect(state.layout).toEqual({ panes: [], focus: 0, maximized: false });
		expect(observe(select(state, live("a")))).toEqual({ hash: "#a", ratios: { columns: 0.62, rows: 0.37 } });
	});

	test("an initial saved-session split can be remembered before a roster arrives", () => {
		const state = initialState(routeFromHash("#past/one,past/two@1;max"), { columns: 0.64, rows: 0.39 });
		const away = select(state, past("three"));
		expect(hashForLayout(away.layout)).toBe("#past/three");
		expect(observe(select(away, past("two")))).toEqual({ hash: "#past/one,past/two@1", ratios: { columns: 0.64, rows: 0.39 } });
	});

	test("an initial split waits for every live source without recording a partial group", () => {
		let state = initialState(routeFromHash("#a,b@1;max"), { columns: 0.62, rows: 0.37 });
		state = roster(state, [host("a")]);
		expect(hashForLayout(state.layout)).toBe("#a,b@1;max");
		const abandoned = select(state, live("c"));
		expect(hashForLayout(select(roster(abandoned, [host("a"), host("b"), host("c")]), live("a")).layout)).toBe("#a");
		state = roster(state, [host("a"), host("b"), host("c")]);
		expect(hashForLayout(select(select(state, live("c")), live("b")).layout)).toBe("#a,b@1");
	});

	test("a start's unidentified live pane waits for roster facts and never leaves the old overlapping group", () => {
		let state = setup();
		const next = layoutAfterStart(state.layout, { kind: "new", cwd: "/work", prompt: "hi", images: [], model: null, thinking: null, skill: null, branch: null, todoId: null }, "fresh");
		if (!next) throw new Error("A new session must open a pane");
		state = command(state, { kind: "edit", layout: next });
		expect(hashForLayout(state.layout)).toBe("#a,fresh@1");
		const beforeFacts = select(state, live("b"));
		expect(hashForLayout(beforeFacts.layout)).toBe("#b");
		state = roster(state, [host("a"), host("b"), host("c"), host("fresh")]);
		expect(hashForLayout(select(select(state, live("c")), live("a")).layout)).toBe("#a,fresh");
	});

	test("resuming all changes only the past panes and keeps their source group's geometry", () => {
		let state = setup("#past/session-a,b@1");
		const next = layoutAfterResumeAll(state.layout, [{ sessionId: "session-a", instanceId: "resumed" }]);
		if (!next) throw new Error("The past pane must resume");
		state = command(state, { kind: "edit", layout: next });
		state = roster(state, [host("resumed", "session-a"), host("b"), host("c")]);
		expect(observe(select(select(state, live("c")), live("b")))).toEqual({ hash: "#resumed,b@1", ratios: { columns: 0.62, rows: 0.37 } });
	});
});

describe("ending sessions", () => {
	test("a failed end preserves remembered groups and the visible layout", () => {
		const state = select(setup(), live("c"));
		const ending = reduce(state, { t: "end", instanceId: "a" });
		const failed = reduce(ending, { t: "ended", instanceId: "a" });
		expect(hashForLayout(failed.layout)).toBe("#c");
		expect(hashForLayout(select(failed, live("b")).layout)).toBe("#a,b@1");
	});

	test("a successful end forgets roots and subagents after their roster source disappears", () => {
		const agent: AgentRow = { id: "worker", kind: "task", parentId: null, status: "idle", activity: null, canMessage: true, queue: { steering: [], followUp: [] } };
		let state = select(setup("#a/worker,b", [host("a", "session-a", [agent]), host("b"), host("c")]), live("c"));
		state = reduce(state, { t: "end", instanceId: "a" });
		state = roster(state, [host("b"), host("c")]);
		state = reduce(state, { t: "end-success", instanceId: "a", sessionId: "session-a", listed: ["a", "b", "c"] });
		state = roster(state, [host("a", "session-a", [agent]), host("b"), host("c")]);
		expect(hashForLayout(select(state, live("b")).layout)).toBe("#b");
		expect(hashForLayout(select(state, live("a", "worker")).layout)).toBe("#a/worker");
	});

	test("successful end keeps existing neighbor replacement and registers only the surviving split", () => {
		let state = setup("#a,b@1");
		state = reduce(state, { t: "end", instanceId: "b" });
		state = reduce(state, { t: "end-success", instanceId: "b", sessionId: "session-b", listed: ["a", "b", "c", "d"] });
		expect(hashForLayout(state.layout)).toBe("#a,c@1");
		expect(hashForLayout(select(select(state, live("d")), live("a")).layout)).toBe("#a,c");
		expect(hashForLayout(select(state, past("session-b")).layout)).toBe("#past/session-b");
	});
});
