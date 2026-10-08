import { describe, expect, test } from "bun:test";
import type { LiveSession } from "../live-session";
import type { SessionFacts } from "../shared/sessions";
import { LiveSessions, withSubject } from "./live-sessions";

const facts: SessionFacts = { pullRequests: [{ owner: "acme", repo: "webapp", number: 7, link: "submitted" }], tickets: ["ENG-1"], ship: null, worktree: null };

describe("withSubject", () => {
	test("puts a quick action's pull request or issue first among the session's links", () => {
		expect(withSubject(facts, { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 12 } }).pullRequests).toEqual([
			{ owner: "acme", repo: "webapp", number: 12, link: "worked" },
			{ owner: "acme", repo: "webapp", number: 7, link: "submitted" },
		]);
		expect(withSubject(facts, { kind: "ticket", id: "ENG-2" }).tickets).toEqual(["ENG-2", "ENG-1"]);
	});

	test("keeps the links as the tool calls found them once they name the subject", () => {
		expect(withSubject(facts, { kind: "pull-request", pr: { owner: "ACME", repo: "webapp", number: 7 } })).toEqual(facts);
		expect(withSubject(facts, { kind: "ticket", id: "ENG-1" })).toEqual(facts);
		expect(withSubject(facts, undefined)).toEqual(facts);
	});
});

describe("LiveSessions", () => {
	test("finds a session by the session file it continues, also after it moved to another file", () => {
		const updates: string[] = [];
		const sessions = new LiveSessions((_instanceId, update) => updates.push(update.kind));
		const first = { instanceId: "i1", sessionId: "s1", cwd: "/work", follow() {}, finished: () => false } as unknown as LiveSession & { sessionId: string };
		const second = { instanceId: "i2", sessionId: "s2", cwd: "/work", follow() {}, finished: () => false } as unknown as LiveSession & { sessionId: string };
		expect(sessions.add(first, null)).toBe(true);
		expect(sessions.add(second, null)).toBe(true);
		expect(sessions.bySessionId("s2")).toBe(second);
		expect(sessions.bySessionId("s3")).toBeUndefined();

		const { instanceId, emit } = sessions.allocate();
		expect(instanceId).toHaveLength(16);
		second.sessionId = "s3";
		emit({ kind: "switched" });
		expect(sessions.bySessionId("s3")).toBe(second);
		expect(sessions.bySessionId("s2")).toBeUndefined();
		expect(updates).toEqual(["switched"]);

		sessions.remove("i1");
		expect(sessions.bySessionId("s1")).toBeUndefined();
	});

	test("refuses a session that already finished, so a process that exited as it spawned is never listed", () => {
		const sessions = new LiveSessions(() => {});
		const dead = { instanceId: "i1", sessionId: "s1", cwd: "/work", follow() {}, finished: () => true } as unknown as LiveSession;
		expect(sessions.add(dead, null)).toBe(false);
		expect(sessions.get("i1")).toBeUndefined();
		expect(sessions.bySessionId("s1")).toBeUndefined();
	});
});
