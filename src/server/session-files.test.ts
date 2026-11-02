import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeFormat } from "../foreign/claude-code";
import { codexFormat } from "../foreign/codex";
import { ompFormat } from "../session-formats";
import { SessionFiles } from "./session-files";

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

const writeLines = (path: string, lines: unknown[]): void => writeFileSync(path, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);

function setup() {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-session-files-"));
	roots.push(root);
	const project = join(root, "omp", "project");
	mkdirSync(project, { recursive: true });
	const claude = join(root, "claude");
	const codex = join(root, "codex", "sessions");
	return { root, project, claude, codex, files: new SessionFiles([ompFormat(join(root, "omp")), claudeCodeFormat(claude), codexFormat(codex)]) };
}

const titles = (files: SessionFiles): (string | null)[] => files.past(new Set(), () => false).map(session => session.title);
const pastIds = (files: SessionFiles): string[] => files.past(new Set(), () => false).map(session => session.sessionId);

/** One message entry of an omp session file, written at `time`. */
const message = (id: string, parentId: string | null, time: string, role: "user" | "assistant", text: string) => ({
	type: "message",
	id,
	parentId,
	timestamp: time,
	message: role === "user" ? { role, content: text, timestamp: Date.parse(time) } : { role, ...model, content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.parse(time) },
});

/**
 * Session `orig`, and the copy omp went on with in a new file when it could not keep writing `orig`'s, as omp's move off a
 * held file writes it: a new id whose header names `orig`, every turn of `orig`, and a newer one.
 */
function continuedSession(project: string) {
	const original = join(project, "2026-11-01T10-00-00-000Z_orig.jsonl");
	const copy = join(project, "2026-11-01T10-05-00-000Z_copy.jsonl");
	const turn = [message("m1", null, "2026-11-01T10:00:01.000Z", "user", "Fix the login in https://github.com/acme/app/pull/7"), message("m2", "m1", "2026-11-01T10:00:02.000Z", "assistant", "On it")];
	writeLines(original, [{ type: "session", version: 3, id: "orig", timestamp: "2026-11-01T10:00:00.000Z", cwd: "/tmp" }, ...turn]);
	utimesSync(original, 1_000, 1_000);
	const writeCopy = () => {
		writeLines(copy, [
			{ type: "session", version: 3, id: "copy", timestamp: "2026-11-01T10:05:00.000Z", cwd: "/tmp", parentSession: "orig", continuationOf: "orig" },
			...turn,
			message("m3", "m2", "2026-11-01T10:05:01.000Z", "user", "Carry on"),
		]);
		utimesSync(copy, 2_000, 2_000);
	};
	return { original, copy, writeCopy };
}

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

	test("the past list leaves out a session marked as an `omp -p` run once its facts are read", async () => {
		const { project, files } = setup();
		const headlessPath = join(project, "headless.jsonl");
		writeSession(join(project, "kept.jsonl"), "kept", "kept", 1_000_000);
		writeSession(headlessPath, "headless", "one-shot", 2_000_000);
		const mark = (headless: boolean, id: string) => writeFileSync(headlessPath, `${JSON.stringify({ type: "custom", customType: "omp-agents.headless", data: { headless }, id, parentId: "a1", timestamp: at })}\n`, { flag: "a" });
		mark(true, "h1");
		await files.scan();
		expect(await files.refreshFacts()).toBe(true);
		expect(titles(files)).toEqual(["kept"]);

		// Resumed in a terminal, it lists again.
		mark(false, "h2");
		files.touch(headlessPath);
		await files.refresh();
		expect(await files.refreshFacts()).toBe(true);
		expect(titles(files)).toEqual(["one-shot", "kept"]);
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

	test("Claude Code and Codex sessions list beside omp's, never interrupted, and their files' changes are touches", async () => {
		const { project, claude, codex, files } = setup();
		writeSession(join(project, "a.jsonl"), "a", "omp session", 1_000_000);
		mkdirSync(join(claude, "-tmp"), { recursive: true });
		const claudeFile = join(claude, "-tmp", "c1.jsonl");
		writeLines(claudeFile, [
			{ type: "user", uuid: "u1", sessionId: "c1", cwd: "/tmp", timestamp: at, message: { role: "user", content: "fix the login" } },
			{ type: "assistant", uuid: "a1", sessionId: "c1", cwd: "/tmp", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
		]);
		utimesSync(claudeFile, 2_000, 2_000);
		mkdirSync(join(codex, "2026", "10", "01"), { recursive: true });
		const codexFile = join(codex, "2026", "10", "01", "rollout-2026-10-01T12-00-00-0199a000-0000-7000-8000-000000000001.jsonl");
		writeLines(codexFile, [
			{ type: "session_meta", timestamp: at, payload: { id: "x1", cwd: "/tmp", source: "vscode" } },
			{ type: "response_item", timestamp: at, payload: { type: "message", role: "user", content: [{ type: "input_text", text: "add a test" }] } },
		]);
		utimesSync(codexFile, 3_000, 3_000);

		expect(await files.scan()).toBe(true);
		const rows = files.past(new Set(), () => true);
		expect(rows.map(row => [row.title, row.source, row.interrupted])).toEqual([
			["add a test", "codex", false],
			["fix the login", "claude-code", false],
			["omp session", "omp", true],
		]);
		expect(files.pathOf("c1")).toBe(claudeFile);
		expect(files.touch(claudeFile)).toBe(true);
		expect(files.touch(codexFile)).toBe(true);
		expect(files.touch(join(claude, "-tmp", "c1", "subagents", "agent-1.jsonl"))).toBe(false);
	});

	test("a session omp went on with in another file lists as that copy alone, which carries its links, and still resolves by its own id", async () => {
		const { project, files } = setup();
		const { original, writeCopy } = continuedSession(project);
		writeCopy();
		expect(await files.scan()).toBe(true);
		expect(pastIds(files)).toEqual(["copy"]);
		expect(files.pathOf("orig")).toBe(original);
		await files.refreshFacts();
		expect(files.past(new Set(), () => false).map(row => row.pullRequests.map(pr => `${pr.owner}/${pr.repo}#${pr.number}`))).toEqual([["acme/app#7"]]);
		expect(await files.scan()).toBe(false);
		expect(pastIds(files)).toEqual(["copy"]);
	});

	test("the copy replaces its session's row once the watcher reports it, and both list once that session goes on past the copy", async () => {
		const { project, files } = setup();
		const { original, copy, writeCopy } = continuedSession(project);
		await files.scan();
		expect(pastIds(files)).toEqual(["orig"]);

		writeCopy();
		files.touch(copy);
		expect(await files.refresh()).toBe(true);
		expect(pastIds(files)).toEqual(["copy"]);

		// The process that held the original writes a turn the copy never got.
		writeFileSync(original, `${JSON.stringify(message("m3b", "m2", "2026-11-01T10:06:00.000Z", "user", "Also the signup"))}\n`, { flag: "a" });
		utimesSync(original, 3_000, 3_000);
		files.touch(original);
		expect(await files.refresh()).toBe(true);
		expect(pastIds(files)).toEqual(["orig", "copy"]);
	});

	test("a session whose copy is an `omp -p` run lists again once the copy's facts show that", async () => {
		const { project, files } = setup();
		const { copy, writeCopy } = continuedSession(project);
		writeCopy();
		writeFileSync(copy, `${JSON.stringify({ type: "custom", customType: "omp-agents.headless", data: { headless: true }, id: "h1", parentId: "m3", timestamp: at })}\n`, { flag: "a" });
		utimesSync(copy, 2_000, 2_000);
		await files.scan();
		expect(pastIds(files)).toEqual(["copy"]);
		expect(await files.refreshFacts()).toBe(true);
		expect(pastIds(files)).toEqual(["orig"]);
	});
});
