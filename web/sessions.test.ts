import { describe, expect, test } from "bun:test";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import { defaultCwd, discoverableSessions, listedViews, searchSessions, sidebarSessions, waitingCount, workspaceSession, workspaceSwitch } from "./sessions";

const host = (sessionId: string, cwd: string) => ({ instanceId: `i-${sessionId}`, sessionId, cwd }) as RosterHost;
const past = (sessionId: string, cwd: string, interrupted: boolean) => ({ sessionId, cwd, interrupted }) as PastSession;
const ids = (rows: { sessionId: string }[]) => rows.map(row => row.sessionId);
const none = new Set<string>();

describe("discoverableSessions", () => {
	test("hides temporary roots and descendants but keeps lookalikes and directories named tmp elsewhere", () => {
		const paths = [
			"/tmp",
			"/tmp/",
			"/tmp/build",
			"/tmp/build/nested/",
			"/private/tmp",
			"/private/tmp/",
			"/private/tmp/build",
			"/private/tmp/build/nested/",
			"/tmp-workspace",
			"/private/tmp-workspace",
			"/home/user/tmp",
			"/home/user/tmp/workspace/",
			"",
		];
		const hosts = paths.map((cwd, index) => host(`h${index}`, cwd));
		const sessions = paths.map((cwd, index) => past(`p${index}`, cwd, index % 2 === 0));
		const visible = discoverableSessions(hosts, sessions, none);
		expect(visible.hosts.map(row => row.cwd)).toEqual(["/tmp-workspace", "/private/tmp-workspace", "/home/user/tmp", "/home/user/tmp/workspace/", ""]);
		expect(visible.past.map(row => row.cwd)).toEqual(["/tmp-workspace", "/private/tmp-workspace", "/home/user/tmp", "/home/user/tmp/workspace/", ""]);
	});

	test("a hidden workspace hides its own sessions, not those of the directories inside it", () => {
		const hosts = [host("a", "/home/user/app"), host("b", "/home/user/app/web"), host("c", "/home/user/other")];
		expect(discoverableSessions(hosts, [], new Set(["/home/user/app"])).hosts.map(row => row.cwd)).toEqual(["/home/user/app/web", "/home/user/other"]);
		expect(workspaceSwitch("/home/user/other", "/home/user/app", new Set(["/home/user/app"]))).toBeNull();
	});

	test("hidden sessions stay out of pinned and interrupted lists without losing saved rows", () => {
		const hosts = [host("hidden-live", "/tmp/job"), host("pinned-live", "~/workspace"), host("running", "~/workspace")];
		const sessions = [
			past("hidden-interrupted", "/private/tmp/job", true),
			past("hidden-ended", "/tmp/", false),
			past("pinned-interrupted", "~/workspace", true),
			past("pinned-ended", "~/workspace", false),
			past("interrupted", "~/workspace", true),
			past("ended", "~/workspace", false),
		];
		const visible = discoverableSessions(hosts, sessions, none);
		const lists = sidebarSessions(
			visible.hosts,
			visible.past,
			null,
			new Set(["hidden-live", "hidden-interrupted", "hidden-ended", "pinned-live", "pinned-ended", "pinned-interrupted"]),
		);
		expect(ids(lists.pinned.hosts)).toEqual(["pinned-live"]);
		expect(ids(lists.pinned.past)).toEqual(["pinned-interrupted", "pinned-ended"]);
		expect(ids(lists.running)).toEqual(["running"]);
		expect(ids(lists.interrupted)).toEqual(["interrupted"]);
		expect(ids(lists.ended)).toEqual(["ended"]);
		expect(ids(hosts)).toEqual(["hidden-live", "pinned-live", "running"]);
		expect(ids(sessions)).toEqual(["hidden-interrupted", "hidden-ended", "pinned-interrupted", "pinned-ended", "interrupted", "ended"]);
		expect(visible.hosts[0]).toBe(hosts[1]);
		expect(visible.past[0]).toBe(sessions[2]);
	});

	test("a temp cwd is not a workspace switch", () => {
		for (const cwd of ["/tmp", "/tmp/", "/tmp/job", "/private/tmp", "/private/tmp/", "/private/tmp/job"]) {
			expect(workspaceSwitch("~/app", cwd, none)).toBeNull();
		}
		expect(workspaceSwitch("~/app", "/tmp-workspace", none)).toBe("/tmp-workspace");
		expect(workspaceSwitch("~/app", "~/other", none)).toBe("~/other");
		expect(workspaceSwitch(null, "~/other", none)).toBeNull();
		expect(workspaceSwitch("~/app", "~/app", none)).toBeNull();
	});
});

describe("workspaceSession", () => {
	const running = (instanceId: string, cwd: string, startedAt: number) => ({ instanceId, cwd, startedAt }) as RosterHost;
	const hosts = [running("old", "~/app", 1), running("new", "~/app", 3), running("other", "~/other", 5)];

	test("opens the workspace's most recently started running session", () => {
		expect(workspaceSession("~/app", hosts, "~/other")).toEqual({ kind: "live", instanceId: "new", agentId: null });
		expect(workspaceSession("~/app", hosts, undefined)).toEqual({ kind: "live", instanceId: "new", agentId: null });
	});

	test("opens nothing for All workspaces, a pane already in the workspace, or a workspace with no running session", () => {
		expect(workspaceSession(null, hosts, "~/other")).toBeNull();
		expect(workspaceSession("~/app", hosts, "~/app")).toBeNull();
		expect(workspaceSession("~/idle", hosts, "~/other")).toBeNull();
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

	test("stays in the selected workspace, so the new session is listed under it", () => {
		expect(defaultCwd({ kind: "live", instanceId: "b", agentId: null }, hosts, sessions, "~/old")).toBe("~/old");
		expect(defaultCwd(null, hosts, sessions, "~/saved")).toBe("~/saved");
	});
});

describe("sidebarSessions", () => {
	const hosts = [host("h1", "~/a"), host("h2", "~/a"), host("h3", "~/b")];
	const sessions = [past("p1", "~/a", false), past("p2", "~/a", true), past("p3", "~/a", false), past("p4", "~/b", true)];

	test("a pinned session leaves its own list, and pinned past sessions list interrupted ones first", () => {
		const lists = sidebarSessions(hosts, sessions, null, new Set(["h2", "p1", "p4"]));
		expect(ids(lists.pinned.hosts)).toEqual(["h2"]);
		expect(ids(lists.pinned.past)).toEqual(["p4", "p1"]);
		expect(ids(lists.running)).toEqual(["h1", "h3"]);
		expect(ids(lists.interrupted)).toEqual(["p2"]);
		expect(ids(lists.ended)).toEqual(["p3"]);
	});

	test("a pinned session from another workspace stays out of the selected workspace's lists", () => {
		const lists = sidebarSessions(hosts, sessions, "~/a", new Set(["h3", "p4", "p3"]));
		expect(ids(lists.pinned.hosts)).toEqual([]);
		expect(ids(lists.pinned.past)).toEqual(["p3"]);
		expect(ids(lists.running)).toEqual(["h1", "h2"]);
	});

	test("an idle session leaves running for its own list, a pinned one stays pinned, and a question keeps it running", () => {
		const statuses = { h1: "idle", h2: "needs-input", h3: "working", h4: "idle", h5: "unknown" } as const;
		const live = Object.entries(statuses).map(([id, status]) => ({ ...host(id, "~/a"), status }));
		const lists = sidebarSessions(live, [], null, new Set(["h4"]));
		expect(ids(lists.pinned.hosts)).toEqual(["h4"]);
		expect(ids(lists.running)).toEqual(["h2", "h3", "h5"]);
		expect(ids(lists.idle)).toEqual(["h1"]);
	});

	test("the waiting count takes finished turns and open questions in the selected workspace, pinned ones included", () => {
		const statuses = { h1: "idle", h2: "needs-input", h3: "working", h4: "idle", h5: "unknown" } as const;
		const live = [...Object.entries(statuses).map(([id, status]) => ({ ...host(id, "~/a"), status })), { ...host("h6", "~/b"), status: "idle" as const }];
		expect(waitingCount(sidebarSessions(live, [], "~/a", new Set(["h4"])))).toBe(3);
	});

	test("the previous and next session keys walk pinned rows first, then idle, running, interrupted, and past", () => {
		const live = [{ ...host("h0", "~/a"), status: "idle" as const }, ...hosts];
		const lists = sidebarSessions(live, sessions, "~/a", new Set(["h2", "p3"]));
		expect(listedViews(lists)).toEqual([
			{ kind: "live", instanceId: "i-h2", agentId: null },
			{ kind: "past", sessionId: "p3" },
			{ kind: "live", instanceId: "i-h0", agentId: null },
			{ kind: "live", instanceId: "i-h1", agentId: null },
			{ kind: "past", sessionId: "p2" },
			{ kind: "past", sessionId: "p1" },
		]);
	});

	test("a search keeps the rows whose title or directory holds every word, in any order and any case, pinned ones included", () => {
		const titled = (row: RosterHost | PastSession, title: string | null, cwdDisplay: string) => ({ ...row, cwdDisplay, sessionName: title, title });
		const live = [titled(host("h1", "~/a"), "Fix login", "~/code/webapp"), titled(host("h2", "~/a"), "Fix billing", "~/code/api"), titled(host("h3", "~/b"), null, "~/code/webapp")] as RosterHost[];
		const saved = [titled(past("p1", "~/a", false), "Login copy", "~/code/webapp"), titled(past("p2", "~/a", false), "Login copy", "~/code/api")] as PastSession[];
		const lists = searchSessions(sidebarSessions(live, saved, null, new Set(["h2", "p1"])), "  WEBAPP login ");
		expect(ids(lists.running)).toEqual(["h1"]);
		expect(ids(lists.pinned.past)).toEqual(["p1"]);
		expect(ids([...lists.pinned.hosts, ...lists.ended])).toEqual([]);
		expect(ids(searchSessions(sidebarSessions(live, saved, "~/b", new Set()), "webapp").running)).toEqual(["h3"]);
	});
});
