import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionFiles, sessionFileOf } from "./session-files";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const at = "2026-10-01T12:00:00.000Z";
const model = { api: "anthropic-messages", provider: "anthropic", model: "claude" };

/** A session file with one answered prompt, so that omp lists it. */
function writeSession(path: string, id: string, title: string, mtime: number): void {
	const lines = [
		{ type: "session", version: 3, id, timestamp: at, cwd: "/tmp", title },
		{ type: "message", id: "u1", parentId: null, timestamp: at, message: { role: "user", content: "hello", timestamp: 1 } },
		{ type: "message", id: "a1", parentId: "u1", timestamp: at, message: { role: "assistant", ...model, content: [{ type: "text", text: "hi" }], stopReason: "stop", timestamp: 2 } },
	];
	writeFileSync(path, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);
	utimesSync(path, mtime / 1000, mtime / 1000);
}

function setup() {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-session-files-"));
	roots.push(root);
	const project = join(root, "project");
	mkdirSync(project);
	return { root, project, files: new SessionFiles(root) };
}

const titles = (files: SessionFiles): (string | null)[] => files.past(new Set(), () => false).map(session => session.title);

describe("sessionFileOf", () => {
	const root = "/sessions";

	test("a session file, and the lock sidecars omp writes beside it, name the session file", () => {
		expect(sessionFileOf("/sessions/p/a.jsonl", root)).toBe("/sessions/p/a.jsonl");
		expect(sessionFileOf("/sessions/p/.a.jsonl.lock", root)).toBe("/sessions/p/a.jsonl");
		expect(sessionFileOf("/sessions/p/.a.jsonl.lock.os", root)).toBe("/sessions/p/a.jsonl");
	});

	test("subagent files, other files, and files elsewhere name no session file", () => {
		expect(sessionFileOf("/sessions/p/a/sub.jsonl", root)).toBeNull();
		expect(sessionFileOf("/sessions/p/a.jsonl.1.bak", root)).toBeNull();
		expect(sessionFileOf("/sessions/p", root)).toBeNull();
		expect(sessionFileOf("/elsewhere/p/a.jsonl", root)).toBeNull();
	});
});

describe("SessionFiles", () => {
	test("a refresh reads only the files the watcher reported", async () => {
		const { project, files } = setup();
		const a = join(project, "a.jsonl");
		const b = join(project, "b.jsonl");
		writeSession(a, "a", "first", 1_000_000);
		writeSession(b, "b", "second", 2_000_000);
		expect(await files.scan()).toBe(true);
		expect(titles(files)).toEqual(["second", "first"]);

		// Both change on disk; only `a` is reported.
		writeSession(a, "a", "first, renamed", 3_000_000);
		writeSession(b, "b", "second, renamed", 4_000_000);
		expect(files.touch(a)).toBe(true);
		expect(await files.refresh()).toBe(true);
		expect(titles(files)).toEqual(["first, renamed", "second"]);

		expect(await files.refresh()).toBe(false);
	});

	test("a refresh adds a file that appeared and drops one that is gone", async () => {
		const { project, files } = setup();
		const a = join(project, "a.jsonl");
		writeSession(a, "a", "first", 1_000_000);
		await files.scan();

		const b = join(project, "b.jsonl");
		writeSession(b, "b", "second", 2_000_000);
		files.touch(b);
		expect(await files.refresh()).toBe(true);
		expect(files.pathOf("b")).toBe(b);

		unlinkSync(a);
		files.touch(a);
		expect(await files.refresh()).toBe(true);
		expect(files.pathOf("a")).toBeNull();
		expect(titles(files)).toEqual(["second"]);
	});

	test("a full scan picks up what no event reported, and reports nothing when the list is unchanged", async () => {
		const { project, files } = setup();
		writeSession(join(project, "a.jsonl"), "a", "first", 1_000_000);
		expect(await files.scan()).toBe(true);
		expect(await files.scan()).toBe(false);

		writeSession(join(project, "b.jsonl"), "b", "second", 2_000_000);
		expect(await files.scan()).toBe(true);
		expect(titles(files)).toEqual(["second", "first"]);
	});

	test("a past row keeps its identity until its file or its interruption changes", async () => {
		const { project, files } = setup();
		const a = join(project, "a.jsonl");
		writeSession(a, "a", "first", 1_000_000);
		writeSession(join(project, "b.jsonl"), "b", "second", 2_000_000);
		await files.scan();
		const [b1, a1] = files.past(new Set(), () => false);
		const [b2, a2] = files.past(new Set(), () => false);
		expect(b2).toBe(b1!);
		expect(a2).toBe(a1!);

		const [b3, a3] = files.past(new Set(), id => id === "a");
		expect(b3).toBe(b1!);
		expect(a3).not.toBe(a1!);
		expect(a3!.interrupted).toBe(true);

		writeSession(a, "a", "first, renamed", 3_000_000);
		files.touch(a);
		await files.refresh();
		const [a4, b4] = files.past(new Set(), id => id === "a");
		expect(b4).toBe(b1!);
		expect(a4!.title).toBe("first, renamed");
	});
});
