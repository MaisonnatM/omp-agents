import { describe, expect, test } from "bun:test";
import type { PastSession, RosterHost } from "../src/shared";
import { defaultCwd } from "./sessions";

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
