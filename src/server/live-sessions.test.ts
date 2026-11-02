import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { LiveSession } from "../live-session";
import type { SessionFacts } from "../shared/sessions";
import { LiveSessions, withSubject } from "./live-sessions";

const facts: SessionFacts = { pullRequests: [{ owner: "acme", repo: "webapp", number: 7, link: "submitted" }], tickets: ["ENG-1"], ship: null, worktree: null, branch: null, workspace: null };

const dirs: string[] = [];
afterEach(() => {
	mock.restore();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Where a test's servers keep their unread turns, one temp file per test. */
function unreadIn(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-unread-"));
	dirs.push(dir);
	return join(dir, "unread", "4123.json");
}

const liveSession = (instanceId: string) =>
	({ instanceId, sessionId: `s-${instanceId}`, cwd: "/work", row: () => ({ instanceId }), follow() {}, finished: () => false }) as unknown as LiveSession;

/** A server starting over `path`, listing the sessions `instanceIds` names. */
function registry(path: string, ...instanceIds: string[]): LiveSessions {
	const sessions = new LiveSessions(() => {}, undefined, path);
	for (const instanceId of instanceIds) sessions.add(liveSession(instanceId), null);
	return sessions;
}

/** Each listed session's instance id with its unread turn. */
const unreadOf = (sessions: LiveSessions) => sessions.rows(() => facts).map(row => [row.instanceId, row.unread]);

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

	test("a row carries the turn its session ended unseen, with its reply's first line, body, and suggestions, until a look, the next turn, or the session leaving reads it", () => {
		const sessions = registry(unreadIn(), "i1");
		const unread = () => sessions.rows(() => facts)[0]?.unread;
		expect(sessions.markRead("i1")).toBe(false);
		sessions.markUnread("i1", { at: 1_000, reply: { body: "\n  Fixed the **flaky** test.  \nDetails follow.", suggestions: ["Merge on main"] } });
		expect(unread()).toEqual({ at: 1_000, reply: "Fixed the **flaky** test.", body: "Fixed the **flaky** test.  \nDetails follow.", suggestions: ["Merge on main"] });
		expect(sessions.markRead("i1")).toBe(true);
		expect(sessions.markRead("i1")).toBe(false);
		expect(unread()).toBeNull();

		sessions.markUnread("i1", { at: 2_000, reply: null });
		expect(unread()).toEqual({ at: 2_000, reply: null, body: null, suggestions: [] });
		sessions.remove("i1");
		sessions.add(liveSession("i1"), null);
		expect(unread()).toBeNull();
	});

	test("an unread turn comes back after a restart for a session that survived it, and only when the next server restores it", () => {
		const path = unreadIn();
		const first = registry(path, "i-kept", "i-gone");
		first.markUnread("i-kept", { at: 1_000, reply: { body: "Fixed the test.\nDetails follow.", suggestions: ["Merge on main"] } });
		first.markUnread("i-gone", { at: 2_000, reply: null });
		flushJsonFiles();

		const second = registry(path, "i-kept", "i-gone");
		expect(unreadOf(second)).toEqual([["i-kept", null], ["i-gone", null]]);
		second.restoreUnread(new Set(["i-kept"]));
		const kept = { at: 1_000, reply: "Fixed the test.", body: "Fixed the test.\nDetails follow.", suggestions: ["Merge on main"] };
		expect(unreadOf(second)).toEqual([["i-kept", kept], ["i-gone", null]]);
		flushJsonFiles();

		// The turn of a session that did not survive the restart is forgotten, so it never comes back.
		const third = registry(path, "i-kept", "i-gone");
		third.restoreUnread(new Set(["i-kept", "i-gone"]));
		expect(unreadOf(third)).toEqual([["i-kept", kept], ["i-gone", null]]);
	});

	test("a turn read or a session removed before a restart stays read after it", () => {
		const path = unreadIn();
		const first = registry(path, "i-read", "i-removed", "i-unread");
		for (const instanceId of ["i-read", "i-removed", "i-unread"]) first.markUnread(instanceId, { at: 1_000, reply: { body: "Done.", suggestions: [] } });
		first.markRead("i-read");
		first.remove("i-removed");
		flushJsonFiles();

		const next = registry(path, "i-read", "i-removed", "i-unread");
		next.restoreUnread(new Set(["i-read", "i-removed", "i-unread"]));
		expect(unreadOf(next)).toEqual([["i-read", null], ["i-removed", null], ["i-unread", { at: 1_000, reply: "Done.", body: "Done.", suggestions: [] }]]);
	});

	test("a file that is not a list of unread turns restores none, and the next turn read unseen replaces it", () => {
		const path = unreadIn();
		registry(path, "i1").markUnread("i1", { at: 1_000, reply: null });
		flushJsonFiles();
		writeFileSync(path, '{"turns": [{"instanceId": "i1", "at": "noon"}]}');
		spyOn(console, "error").mockImplementation(() => {});

		const next = registry(path, "i1");
		next.restoreUnread(new Set(["i1"]));
		expect(unreadOf(next)).toEqual([["i1", null]]);
		next.markUnread("i1", { at: 2_000, reply: null });
		flushJsonFiles();

		const after = registry(path, "i1");
		after.restoreUnread(new Set(["i1"]));
		expect(unreadOf(after)).toEqual([["i1", { at: 2_000, reply: null, body: null, suggestions: [] }]]);
	});
});
