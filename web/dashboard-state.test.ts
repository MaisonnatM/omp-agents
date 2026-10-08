import { describe, expect, test } from "bun:test";
import type { LiveView, RosterHost, View } from "../src/shared/sessions";
import { type DashboardState, initialState, reduce } from "./dashboard-state";
import type { Layout } from "./routing";

const layout = (panes: View[], focus = 0): Layout => ({ panes, focus, maximized: false });
const live = (instanceId: string): LiveView => ({ kind: "live", instanceId, agentId: null });
const host = (instanceId: string, cwd: string): RosterHost => ({ instanceId, cwd }) as RosterHost;
const blank = (): DashboardState => initialState({ kind: "panes", layout: layout([]) });

describe("dashboard state", () => {
	test("a layout keeps the roster row of a pane that stays open, and the last row after it leaves the roster", () => {
		const open = reduce(blank(), { t: "route", route: { kind: "panes", layout: layout([live("a")]) } });
		const listed = reduce(open, { t: "roster", reset: true, hosts: [host("a", "/work")], removed: [], error: null });
		expect(listed.lastHosts.get("a")?.cwd).toBe("/work");
		const gone = reduce(listed, { t: "roster", reset: false, hosts: [], removed: ["a"], error: null });
		expect(gone.hosts).toEqual([]);
		expect(gone.lastHosts.get("a")?.cwd).toBe("/work");
		const closed = reduce(gone, { t: "route", route: { kind: "panes", layout: layout([]) } });
		expect(closed.lastHosts.size).toBe(0);
	});

	test("a roster delta replaces or adds the rows it names, drops the removed, and leaves the rest as the same objects; a reset replaces them all", () => {
		const [a, b] = [host("a", "/work"), host("b", "/other")];
		const listed = reduce(blank(), { t: "roster", reset: true, hosts: [a, b], removed: [], error: null });
		const moved = host("a", "/moved");
		const delta = reduce(listed, { t: "roster", reset: false, hosts: [moved, host("c", "/new")], removed: ["b"], error: "registry down" });
		expect(delta.hosts.map(row => row.cwd)).toEqual(["/moved", "/new"]);
		expect(delta.hosts[0]).toBe(moved);
		expect(delta.rosterError).toBe("registry down");
		const untouched = reduce(listed, { t: "roster", reset: false, hosts: [], removed: [], error: null });
		expect(untouched.hosts[0]).toBe(a);
		expect(untouched.hosts[1]).toBe(b);
		const again = reduce(delta, { t: "roster", reset: true, hosts: [b], removed: [], error: null });
		expect(again.hosts).toEqual([b]);
	});

	test("the same panes stay the same objects, and a layout that names them again changes nothing", () => {
		const view = live("a");
		const open = reduce(blank(), { t: "route", route: { kind: "panes", layout: layout([view]) } });
		const renamed = reduce(open, { t: "route", route: { kind: "panes", layout: layout([live("a")], 0) } });
		expect(renamed).toBe(open);
		const focused = reduce(open, { t: "route", route: { kind: "panes", layout: layout([live("a"), live("b")], 1) } });
		expect(focused.layout.panes[0]).toBe(open.layout.panes[0]);
	});

	test("a fork's draft starts with the prompt it branched at, and forking a reply starts empty", () => {
		const fork = { kind: "fork", view: { kind: "past", sessionId: "s" }, itemId: "u", point: { entryId: "e", prefill: true } } as const;
		const waiting = reduce(blank(), { t: "start", reqId: 1, op: fork });
		const started = reduce(waiting, { t: "started", reqId: 1, result: { ok: true, instanceId: "i", cwd: "/work", prompt: "hello" } });
		expect(started.draft).toEqual({ view: live("i"), text: "hello" });
		expect(started.started).toEqual({ instanceId: "i", cwd: "/work" });
		const reply = reduce(blank(), { t: "start", reqId: 2, op: { ...fork, point: { entryId: "e", prefill: false } } });
		const empty = reduce(reply, { t: "started", reqId: 2, result: { ok: true, instanceId: "j", cwd: "/work", prompt: "hello" } });
		expect(empty.draft).toEqual({ view: live("j"), text: "" });
	});

	test("a start that is not a fork leaves the draft, and closing its view drops the draft", () => {
		const fork = { kind: "fork", view: { kind: "past", sessionId: "s" }, itemId: "u", point: { entryId: "e", prefill: true } } as const;
		const drafted = reduce(reduce(blank(), { t: "start", reqId: 1, op: fork }), {
			t: "started",
			reqId: 1,
			result: { ok: true, instanceId: "i", cwd: "/work", prompt: "hello" },
		});
		const shown = reduce(drafted, { t: "route", route: { kind: "panes", layout: layout([live("i")]) } });
		const resumed = reduce(reduce(shown, { t: "start", reqId: 2, op: { kind: "resume", sessionId: "s" } }), {
			t: "started",
			reqId: 2,
			result: { ok: true, instanceId: "k", cwd: "/work", prompt: null },
		});
		expect(resumed.draft).toBe(shown.draft);
		const closed = reduce(resumed, { t: "route", route: { kind: "panes", layout: layout([]) } });
		expect(closed.draft).toBeNull();
		expect(reduce(blank(), { t: "started", reqId: 9, result: { ok: true, instanceId: "z", cwd: "/", prompt: null } })).toEqual(blank());
	});
});
