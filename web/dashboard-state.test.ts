import { describe, expect, test } from "bun:test";
import type { TrustAsk } from "../src/shared/project-trust";
import type { LiveView, RosterHost, View } from "../src/shared/sessions";
import { type DashboardState, initialState, reduce } from "./dashboard-state";
import type { Layout } from "./routing";
import { refusedStart } from "./starts";

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

	test("a live session's model list is kept without a pane, as a Bot page's is, and goes when the session leaves the roster", () => {
		const listed = reduce(blank(), { t: "roster", reset: true, hosts: [host("bot", "/work")], removed: [], error: null });
		const answered = reduce(listed, { t: "models", instanceId: "bot", models: [], error: null });
		expect(answered.models.get("bot")).toEqual({ data: { models: [] }, error: null });
		const stranger = reduce(answered, { t: "models", instanceId: "ended", models: [], error: null });
		expect(stranger.models.has("ended")).toBe(false);
		const gone = reduce(answered, { t: "roster", reset: false, hosts: [], removed: ["bot"], error: null });
		expect(gone.models.has("bot")).toBe(false);
	});

	test("the same panes stay the same objects, and a layout that names them again changes nothing", () => {
		const view = live("a");
		const open = reduce(blank(), { t: "route", route: { kind: "panes", layout: layout([view]) } });
		const renamed = reduce(open, { t: "route", route: { kind: "panes", layout: layout([live("a")], 0) } });
		expect(renamed).toBe(open);
		const focused = reduce(open, { t: "route", route: { kind: "panes", layout: layout([live("a"), live("b")], 1) } });
		expect(focused.layout.panes[0]).toBe(open.layout.panes[0]);
	});

	test("a start's answer settles it and names the session it started, and an answer to no start changes nothing", () => {
		const fork = { kind: "fork", view: { kind: "past", sessionId: "s" }, itemId: "u", point: { entryId: "e", prefill: true } } as const;
		const waiting = reduce(blank(), { t: "start", reqId: 1, op: fork });
		const started = reduce(waiting, { t: "started", reqId: 1, result: { ok: true, instanceId: "i", workspace: "/work", prompt: "hello" } });
		expect(started.started).toEqual({ instanceId: "i", workspace: "/work" });
		expect(started.starts.size).toBe(0);
		expect(reduce(blank(), { t: "started", reqId: 9, result: { ok: true, instanceId: "z", workspace: "/", prompt: null } })).toEqual(blank());
	});

	test("a start refused for untrusted project code keeps its error and asks with its op, until the dialog closes or the start is sent again", () => {
		const resume = { kind: "resume", sessionId: "s" } as const;
		const trust: TrustAsk = { root: "/repo", rootDisplay: "/repo", code: [{ kind: "tool", id: ".omp/tools/t.ts", name: ".omp/tools/t.ts", hash: "h", change: "new" }] };
		const refused = reduce(reduce(blank(), { t: "start", reqId: 1, op: resume }), { t: "started", reqId: 1, result: { ok: false, error: "not trusted", trust } });
		expect(refusedStart(refused.starts)).toEqual({ reqId: 1, op: resume, trust });
		expect(refusedStart(reduce(refused, { t: "route", route: { kind: "panes", layout: layout([live("a")]) } }).starts)).toEqual({ reqId: 1, op: resume, trust });
		const closed = reduce(refused, { t: "trust-dismiss", reqId: 1 });
		expect(refusedStart(closed.starts)).toBeNull();
		expect(closed.starts.get(1)).toEqual({ op: resume, phase: "failed", error: "not trusted" });
		expect(reduce(closed, { t: "trust-dismiss", reqId: 1 })).toBe(closed);
		expect(refusedStart(reduce(refused, { t: "start", reqId: 2, op: resume }).starts)).toBeNull();
	});

	test("a pin shows before the server answers, one that changes nothing keeps the state, and the server's pins replace them", () => {
		const listed = reduce(blank(), { t: "pins", sessionIds: ["s1"] });
		const pinned = reduce(listed, { t: "pin", change: { op: "pin", sessionIds: ["s2"] } });
		expect(pinned.pins).toEqual(["s1", "s2"]);
		expect(reduce(pinned, { t: "pin", change: { op: "unpin", sessionIds: ["s3"] } })).toBe(pinned);
		expect(reduce(pinned, { t: "pins", sessionIds: ["s2"] }).pins).toEqual(["s2"]);
	});

	test("a session is ending from the page's ask until the server answers, and asking twice changes nothing", () => {
		const ending = reduce(blank(), { t: "end", instanceId: "a" });
		expect([...ending.ending.keys()]).toEqual(["a"]);
		expect(reduce(ending, { t: "end", instanceId: "a" })).toBe(ending);
		const both = reduce(ending, { t: "end", instanceId: "b" });
		expect([...reduce(both, { t: "ended", instanceId: "a" }).ending.keys()]).toEqual(["b"]);
		expect(reduce(ending, { t: "ended", instanceId: "b" })).toBe(ending);
	});

	test("a session ended from a page keeps the page, and one ended from the panes leaves no cover", () => {
		const page = { kind: "page", page: { kind: "calendar" } } as const;
		const onPage = reduce(reduce(blank(), { t: "route", route: page }), { t: "end", instanceId: "a" });
		expect(reduce(onPage, { t: "end-success", instanceId: "a", listed: ["a"] }).cover).toEqual(page);
		const onPanes = reduce(reduce(blank(), { t: "route", route: { kind: "panes", layout: layout([live("a")]) } }), { t: "end", instanceId: "a" });
		expect(reduce(onPanes, { t: "end-success", instanceId: "a", listed: ["a"] }).cover).toBeNull();
	});
});
