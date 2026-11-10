import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { LiveSession } from "../live-session";
import * as collab from "../omp/collab";
import type { HostSnapshot } from "../omp/collab";
import type { SessionFacts } from "../shared/sessions";
import { LiveSessions, withSubject } from "./live-sessions";

const facts: SessionFacts = { pullRequests: [{ owner: "acme", repo: "webapp", number: 7, link: "submitted" }], tickets: ["ENG-1"], ship: null, arenas: [], worktree: null, branch: null, workspace: null };

const dirs: string[] = [];
/** The servers whose guests joined terminal sessions, which a test leaves. */
const following: LiveSessions[] = [];
afterEach(async () => {
	await Promise.all(following.splice(0).map(sessions => sessions.dispose()));
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
	({ instanceId, sessionId: `s-${instanceId}`, cwd: "/work", row: () => ({ instanceId }), follow() {}, finished: () => false, dispose: async () => {} }) as unknown as LiveSession;

/** A server starting over `path`, listing the sessions `instanceIds` names. */
function registry(path: string, ...instanceIds: string[]): LiveSessions {
	const sessions = new LiveSessions(() => {}, undefined, path);
	for (const instanceId of instanceIds) sessions.add(liveSession(instanceId), null);
	return sessions;
}

/** Each listed session's instance id with its unread turn. */
const unreadOf = (sessions: LiveSessions) => sessions.rows(() => facts).map(row => [row.instanceId, row.unread]);

/** Terminal session `instanceId` as the registry lists it, running a turn when `busy`, and `null` when its omp does not say. */
const host = (instanceId: string, busy: boolean | null = false): HostSnapshot => ({
	instanceId,
	generation: 1,
	pid: 4242,
	sessionId: `s-${instanceId}`,
	sessionName: null,
	cwd: "/work",
	model: null,
	startedAt: 1,
	participants: 1,
	relayConnected: true,
	inputRequired: false,
	busy,
	access: "control",
});

/** The registry listing `hosts`, as the dashboard follows it: a guest joins each new one, whose room never opens, and the listing restores the unread turns. */
function list(sessions: LiveSessions, hosts: HostSnapshot[], savedFile: (sessionId: string) => string | null = () => null): void {
	spyOn(collab, "openRoom").mockReturnValue(new Promise(() => {}));
	following.push(sessions);
	sessions.follow(hosts);
	sessions.restoreListedUnread(hosts, savedFile);
}

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

	test("a row says its turn waits from the main agent's wait calls until its turn ends, and heard answers each change", () => {
		const sessions = registry(unreadIn(), "i1");
		const turnWaits = () => sessions.rows(() => facts)[0]?.turnWaits;
		expect(turnWaits()).toBe(false);

		expect(sessions.heard("i1", { type: "tool_execution_start", toolCallId: "c1", toolName: "wait" })).toBe(true);
		expect(turnWaits()).toBe(true);
		expect(sessions.heard("i1", { type: "tool_execution_end", toolCallId: "c1", toolName: "wait" })).toBe(false);
		expect(sessions.heard("i1", { type: "message_update" })).toBe(false);
		expect(turnWaits()).toBe(true);
		expect(sessions.heard("i1", { type: "agent_end" })).toBe(true);
		expect(turnWaits()).toBe(false);
	});

	test("a row carries the turn its session ended unseen, with its reply's first line, until a look, the next turn, or the session leaving reads it", () => {
		const sessions = registry(unreadIn(), "i1");
		const unread = () => sessions.rows(() => facts)[0]?.unread;
		expect(sessions.markRead("i1")).toBe(false);
		sessions.markUnread("i1", { at: 1_000, reply: "\n  Fixed the **flaky** test.  \nDetails follow." });
		expect(unread()).toEqual({ at: 1_000, reply: "Fixed the **flaky** test." });
		expect(sessions.markRead("i1")).toBe(true);
		expect(sessions.markRead("i1")).toBe(false);
		expect(unread()).toBeNull();

		sessions.markUnread("i1", { at: 2_000, reply: null });
		expect(unread()).toEqual({ at: 2_000, reply: null });
		sessions.remove("i1");
		sessions.add(liveSession("i1"), null);
		expect(unread()).toBeNull();
	});

	test("a quiet turn gives back the unread turn its start read, while a look during it or a turn that ends aloud reads it for good", () => {
		const sessions = registry(unreadIn(), "i1");
		const unread = () => sessions.rows(() => facts)[0]?.unread;
		sessions.markUnread("i1", { at: 1_000, reply: "PR #12 needs you." });
		expect(sessions.turnStarted("i1")).toBe(true);
		expect(unread()).toBeNull();
		sessions.turnEnded("i1", null);
		expect(unread()).toEqual({ at: 1_000, reply: "PR #12 needs you." });

		sessions.turnStarted("i1");
		sessions.markRead("i1");
		sessions.turnEnded("i1", null);
		expect(unread()).toBeNull();

		sessions.markUnread("i1", { at: 2_000, reply: "PR #12 needs you." });
		sessions.turnStarted("i1");
		sessions.turnEnded("i1", { at: 3_000, reply: "Fixed PR #12." });
		sessions.turnStarted("i1");
		sessions.turnEnded("i1", null);
		expect(unread()).toEqual({ at: 3_000, reply: "Fixed PR #12." });
	});

	test("an unread turn comes back after a restart for a session that survived it, and only when the next server restores it", () => {
		const path = unreadIn();
		const first = registry(path, "i-kept", "i-gone");
		first.markUnread("i-kept", { at: 1_000, reply: "Fixed the test.\nDetails follow." });
		first.markUnread("i-gone", { at: 2_000, reply: null });
		flushJsonFiles();

		const second = registry(path, "i-kept", "i-gone");
		expect(unreadOf(second)).toEqual([["i-kept", null], ["i-gone", null]]);
		second.restoreUnread(new Set(["i-kept"]));
		const kept = { at: 1_000, reply: "Fixed the test." };
		expect(unreadOf(second)).toEqual([["i-kept", kept], ["i-gone", null]]);
		// The first registry listing does not list it as a terminal session either.
		list(second, []);
		flushJsonFiles();

		// The turn of a session that did not survive the restart is forgotten, so it never comes back.
		const third = registry(path, "i-kept", "i-gone");
		third.restoreUnread(new Set(["i-kept", "i-gone"]));
		expect(unreadOf(third)).toEqual([["i-kept", kept], ["i-gone", null]]);
	});

	test("a terminal session's unread turn comes back at the first registry listing after a restart, which forgets only the turns of the sessions it does not list", () => {
		const path = unreadIn();
		const first = registry(path);
		first.restoreUnread(new Set());
		list(first, [host("t-kept"), host("t-gone")]);
		first.markUnread("t-kept", { at: 1_000, reply: "Fixed the test." });
		first.markUnread("t-gone", { at: 2_000, reply: null });
		flushJsonFiles();

		// No session the dashboard started survived, and this server stops before it lists the registry.
		registry(path).restoreUnread(new Set());
		flushJsonFiles();

		const next = registry(path);
		next.restoreUnread(new Set());
		list(next, [host("t-kept")]);
		const kept = { at: 1_000, reply: "Fixed the test." };
		expect(unreadOf(next)).toEqual([["t-kept", kept]]);
		// Only the first listing restores.
		next.markRead("t-kept");
		list(next, [host("t-kept"), host("t-gone")]);
		expect(unreadOf(next)).toEqual([["t-kept", null], ["t-gone", null]]);
		next.markUnread("t-kept", { at: 3_000, reply: null });
		flushJsonFiles();

		const last = registry(path);
		last.restoreUnread(new Set());
		list(last, [host("t-kept"), host("t-gone")]);
		expect(unreadOf(last)).toEqual([["t-kept", { at: 3_000, reply: null }], ["t-gone", null]]);
	});

	test("a terminal session's turn that ended while no server listened comes back unread from its session file, in place of the turn saved before it", () => {
		const path = unreadIn();
		const hosts = [host("t-ended"), host("t-quiet"), host("t-working", true), host("t-unknown", null), host("t-stopped")];
		spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T10:00:00.000Z"));
		const first = registry(path, "i-dash");
		first.restoreUnread(new Set());
		list(first, hosts);
		for (const instanceId of ["t-ended", "t-quiet", "t-working", "t-unknown"]) first.markUnread(instanceId, { at: 1_000, reply: "Saved reply." });
		flushJsonFiles();

		// The next server marks a turn of a session it started, then stops before it lists the registry, so it heard no terminal session.
		spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T10:30:00.000Z"));
		const crashed = registry(path, "i-dash");
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
			"s-i-dash": later,
		};
		const next = registry(path, "i-dash");
		next.restoreUnread(new Set(["i-dash"]));
		// A session this server started keeps the turn its reattach settled, even if the registry lists it too.
		list(next, [...hosts, host("i-dash")], sessionId => files[sessionId] ?? null);
		expect(unreadOf(next)).toEqual([
			["i-dash", { at: 4_000, reply: null }],
			["t-ended", { at: Date.parse("2026-11-02T10:06:00.000Z"), reply: "Merged." }],
			["t-quiet", { at: 1_000, reply: "Saved reply." }],
			["t-working", null],
			["t-unknown", null],
			// Stopped before it replied, as a turn the server hears end with no reply.
			["t-stopped", { at: Date.parse("2026-11-02T10:07:00.000Z"), reply: null }],
		]);
	});

	test("a turn read or a session removed before a restart stays read after it", () => {
		const path = unreadIn();
		const first = registry(path, "i-read", "i-removed", "i-unread");
		for (const instanceId of ["i-read", "i-removed", "i-unread"]) first.markUnread(instanceId, { at: 1_000, reply: "Done." });
		first.markRead("i-read");
		first.remove("i-removed");
		flushJsonFiles();

		const next = registry(path, "i-read", "i-removed", "i-unread");
		next.restoreUnread(new Set(["i-read", "i-removed", "i-unread"]));
		expect(unreadOf(next)).toEqual([["i-read", null], ["i-removed", null], ["i-unread", { at: 1_000, reply: "Done." }]]);
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
		expect(unreadOf(after)).toEqual([["i1", { at: 2_000, reply: null }]]);
	});

	test("a turn an older server saved with more fields comes back with only its time and first line", () => {
		const path = unreadIn();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, '{"turns": [{"instanceId": "i1", "at": 1000, "reply": "Done.", "body": "Done.\\nDetails.", "suggestions": ["Ship it"]}]}');
		const next = registry(path, "i1");
		next.restoreUnread(new Set(["i1"]));
		expect(unreadOf(next)).toEqual([["i1", { at: 1_000, reply: "Done." }]]);
	});

	test("a turn marked before the restore keeps the turns the previous server saved, and the restore keeps the newer mark", () => {
		const path = unreadIn();
		const first = registry(path, "i-kept", "i-both");
		first.markUnread("i-kept", { at: 1_000, reply: "Fixed the test." });
		first.markUnread("i-both", { at: 1_500, reply: "Old." });
		flushJsonFiles();

		const next = registry(path, "i-kept", "i-both");
		next.markUnread("i-both", { at: 2_000, reply: "New." });
		next.restoreUnread(new Set(["i-kept", "i-both"]));
		expect(unreadOf(next)).toEqual([["i-kept", { at: 1_000, reply: "Fixed the test." }], ["i-both", { at: 2_000, reply: "New." }]]);
	});
});
