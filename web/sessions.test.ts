import { describe, expect, test } from "bun:test";
import type { PastSession, RosterHost } from "../src/shared";
import { defaultCwd, discoverableSessions, listedViews, projectSession, projectSwitch, sidebarSessions } from "./sessions";

const host = (sessionId: string, cwd: string) => ({ instanceId: `i-${sessionId}`, sessionId, cwd }) as RosterHost;
const past = (sessionId: string, cwd: string, interrupted: boolean) => ({ sessionId, cwd, interrupted }) as PastSession;
const ids = (rows: { sessionId: string }[]) => rows.map(row => row.sessionId);

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
			"/tmp-project",
			"/private/tmp-project",
			"/home/user/tmp",
			"/home/user/tmp/project/",
			"",
		];
		const hosts = paths.map((cwd, index) => host(`h${index}`, cwd));
		const sessions = paths.map((cwd, index) => past(`p${index}`, cwd, index % 2 === 0));
		const visible = discoverableSessions(hosts, sessions);
		expect(visible.hosts.map(row => row.cwd)).toEqual(["/tmp-project", "/private/tmp-project", "/home/user/tmp", "/home/user/tmp/project/", ""]);
		expect(visible.past.map(row => row.cwd)).toEqual(["/tmp-project", "/private/tmp-project", "/home/user/tmp", "/home/user/tmp/project/", ""]);
	});

	test("hidden sessions stay out of pinned and interrupted lists without losing saved rows", () => {
		const hosts = [host("hidden-live", "/tmp/job"), host("pinned-live", "~/project"), host("running", "~/project")];
		const sessions = [
			past("hidden-interrupted", "/private/tmp/job", true),
			past("hidden-ended", "/tmp/", false),
			past("pinned-interrupted", "~/project", true),
			past("pinned-ended", "~/project", false),
			past("interrupted", "~/project", true),
			past("ended", "~/project", false),
		];
		const visible = discoverableSessions(hosts, sessions);
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

	test("a temp cwd is not a project switch", () => {
		for (const cwd of ["/tmp", "/tmp/", "/tmp/job", "/private/tmp", "/private/tmp/", "/private/tmp/job"]) {
			expect(projectSwitch("~/app", cwd)).toBeNull();
		}
		expect(projectSwitch("~/app", "/tmp-project")).toBe("/tmp-project");
		expect(projectSwitch("~/app", "~/other")).toBe("~/other");
		expect(projectSwitch(null, "~/other")).toBeNull();
		expect(projectSwitch("~/app", "~/app")).toBeNull();
	});
});

describe("projectSession", () => {
	const running = (instanceId: string, cwd: string, startedAt: number) => ({ instanceId, cwd, startedAt }) as RosterHost;
	const hosts = [running("old", "~/app", 1), running("new", "~/app", 3), running("other", "~/other", 5)];

	test("opens the project's most recently started running session", () => {
		expect(projectSession("~/app", hosts, "~/other")).toEqual({ kind: "live", instanceId: "new", agentId: null });
		expect(projectSession("~/app", hosts, undefined)).toEqual({ kind: "live", instanceId: "new", agentId: null });
	});

	test("opens nothing for All projects, a pane already in the project, or a project with no running session", () => {
		expect(projectSession(null, hosts, "~/other")).toBeNull();
		expect(projectSession("~/app", hosts, "~/app")).toBeNull();
		expect(projectSession("~/idle", hosts, "~/other")).toBeNull();
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

	test("a pinned session from another project stays out of the selected project's lists", () => {
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

	test("the previous and next session keys walk pinned rows first, then running, idle, interrupted, and past", () => {
		const live = [{ ...host("h0", "~/a"), status: "idle" as const }, ...hosts];
		const lists = sidebarSessions(live, sessions, "~/a", new Set(["h2", "p3"]));
		expect(listedViews(lists)).toEqual([
			{ kind: "live", instanceId: "i-h2", agentId: null },
			{ kind: "past", sessionId: "p3" },
			{ kind: "live", instanceId: "i-h1", agentId: null },
			{ kind: "live", instanceId: "i-h0", agentId: null },
			{ kind: "past", sessionId: "p2" },
			{ kind: "past", sessionId: "p1" },
		]);
	});
});
