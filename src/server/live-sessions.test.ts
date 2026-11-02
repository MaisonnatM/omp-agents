import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { LiveSession } from "../live-session";
import type { HostSnapshot } from "../omp/collab";
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

/** Terminal session `instanceId` as the registry lists it, running a turn when `busy`, and `null` when its omp does not say. */
const host = (instanceId: string, busy: boolean | null = false): HostSnapshot => fromPartial({ instanceId, sessionId: `s-${instanceId}`, busy });

const noFile = (): string | null => null;

/** A session file holding one message per `[ISO time, role, text]`, in a directory the test removes. */
function sessionFile(entries: Array<[string, string, string]>): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-terminal-"));
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	const lines = [{ type: "session", id: "s", cwd: dir }, ...entries.map(([timestamp, role, text]) => ({ type: "message", timestamp, message: { role, content: [{ type: "text", text }] } }))];
	writeFileSync(path, lines.map(line => `${JSON.stringify(line)}\n`).join(""));
	return path;
}

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
		// The first registry listing does not list it as a terminal session either.
		second.restoreListedUnread([], noFile);
		flushJsonFiles();

		// The turn of a session that did not survive the restart is forgotten, so it never comes back.
		const third = registry(path, "i-kept", "i-gone");
		third.restoreUnread(new Set(["i-kept", "i-gone"]));
		expect(unreadOf(third)).toEqual([["i-kept", kept], ["i-gone", null]]);
	});

	test("a terminal session's unread turn comes back at the first registry listing after a restart, which forgets only the turns of the sessions it does not list", () => {
		const path = unreadIn();
		const first = registry(path, "t-kept", "t-gone");
		first.markUnread("t-kept", { at: 1_000, reply: { body: "Fixed the test.", suggestions: [] } });
		first.markUnread("t-gone", { at: 2_000, reply: null });
		flushJsonFiles();

		// No session the dashboard started survived, and this server stops before it lists the registry.
		registry(path, "t-kept", "t-gone").restoreUnread(new Set());
		flushJsonFiles();

		const next = registry(path, "t-kept", "t-gone");
		next.restoreUnread(new Set());
		expect(unreadOf(next)).toEqual([["t-kept", null], ["t-gone", null]]);
		next.restoreListedUnread([host("t-kept")], noFile);
		const kept = { at: 1_000, reply: "Fixed the test.", body: "Fixed the test.", suggestions: [] };
		expect(unreadOf(next)).toEqual([["t-kept", kept], ["t-gone", null]]);
		// Only the first listing restores.
		next.markRead("t-kept");
		next.restoreListedUnread([host("t-kept")], noFile);
		expect(unreadOf(next)).toEqual([["t-kept", null], ["t-gone", null]]);
		next.markUnread("t-kept", { at: 3_000, reply: null });
		flushJsonFiles();

		const last = registry(path, "t-kept", "t-gone");
		last.restoreUnread(new Set());
		last.restoreListedUnread([host("t-kept"), host("t-gone")], noFile);
		expect(unreadOf(last)).toEqual([["t-kept", { at: 3_000, reply: null, body: null, suggestions: [] }], ["t-gone", null]]);
	});

	test("a terminal session's turn that ended while no server listened comes back unread from its session file, in place of the turn saved before it", () => {
		const path = unreadIn();
		const ids = ["t-ended", "t-quiet", "t-working", "t-unknown", "t-stopped", "i-dash"];
		spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T10:00:00.000Z"));
		const first = registry(path, ...ids);
		for (const instanceId of ["t-ended", "t-quiet", "t-working", "t-unknown"]) first.markUnread(instanceId, { at: 1_000, reply: { body: "Saved reply.", suggestions: [] } });
		flushJsonFiles();

		// The next server marks a turn of a session it started, then stops before it lists the registry, so it heard no terminal session.
		spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T10:30:00.000Z"));
		const crashed = registry(path, ...ids);
		crashed.restoreUnread(new Set(["i-dash"]));
		crashed.markUnread("i-dash", { at: 4_000, reply: null });
		flushJsonFiles();

		const later = sessionFile([["2026-11-02T10:05:00.000Z", "user", "Merge it"], ["2026-11-02T10:06:00.000Z", "assistant", "Merged."]]);
		const files: Record<string, string> = {
			"s-t-ended": later,
			"s-t-quiet": sessionFile([["2026-11-02T09:58:00.000Z", "user", "Merge it"], ["2026-11-02T09:59:00.000Z", "assistant", "Merged."]]),
			"s-t-working": later,
			"s-t-unknown": later,
			"s-t-stopped": sessionFile([["2026-11-02T09:58:00.000Z", "assistant", "Done."], ["2026-11-02T10:07:00.000Z", "user", "Run the tests"]]),
		};
		const next = registry(path, ...ids);
		next.restoreUnread(new Set(["i-dash"]));
		next.restoreListedUnread([host("t-ended"), host("t-quiet"), host("t-working", true), host("t-unknown", null), host("t-stopped")], sessionId => files[sessionId] ?? null);
		expect(unreadOf(next)).toEqual([
			["t-ended", { at: Date.parse("2026-11-02T10:06:00.000Z"), reply: "Merged.", body: "Merged.", suggestions: [] }],
			["t-quiet", { at: 1_000, reply: "Saved reply.", body: "Saved reply.", suggestions: [] }],
			["t-working", null],
			["t-unknown", null],
			// Stopped before it replied, as a turn the server hears end with no reply.
			["t-stopped", { at: Date.parse("2026-11-02T10:07:00.000Z"), reply: null, body: null, suggestions: [] }],
			["i-dash", { at: 4_000, reply: null, body: null, suggestions: [] }],
		]);
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
