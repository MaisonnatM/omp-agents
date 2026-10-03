import { describe, expect, test } from "bun:test";
import type { PastSession, RosterHost } from "../src/shared";
import { defaultCwd, listedViews, sidebarSessions } from "./sessions";

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
	const host = (sessionId: string, cwd: string) => ({ instanceId: `i-${sessionId}`, sessionId, cwd }) as RosterHost;
	const past = (sessionId: string, cwd: string, interrupted: boolean) => ({ sessionId, cwd, interrupted }) as PastSession;
	const hosts = [host("h1", "~/a"), host("h2", "~/a"), host("h3", "~/b")];
	const sessions = [past("p1", "~/a", false), past("p2", "~/a", true), past("p3", "~/a", false), past("p4", "~/b", true)];
	const ids = (rows: { sessionId: string }[]) => rows.map(row => row.sessionId);

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

	test("the previous and next session keys walk pinned rows first, then running, interrupted, and past", () => {
		const lists = sidebarSessions(hosts, sessions, "~/a", new Set(["h2", "p3"]));
		expect(listedViews(lists)).toEqual([
			{ kind: "live", instanceId: "i-h2", agentId: null },
			{ kind: "past", sessionId: "p3" },
			{ kind: "live", instanceId: "i-h1", agentId: null },
			{ kind: "past", sessionId: "p2" },
			{ kind: "past", sessionId: "p1" },
		]);
	});
});
