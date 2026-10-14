import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transcript } from "../transcript";
import { claudeCodeFileOf, claudeCodeFormat, decodeClaudeCodeLine } from "./claude-code";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = "2026-10-01T12:00:00.000Z";
const base = { sessionId: "c1", cwd: "/work", timestamp: at };
const user = (uuid: string, content: unknown, extra: object = {}) => ({ type: "user", uuid, ...base, ...extra, message: { role: "user", content } });
const assistant = (uuid: string, content: unknown) => ({ type: "assistant", uuid, ...base, message: { role: "assistant", content } });

function itemsOf(records: unknown[]) {
	const transcript = new Transcript();
	for (const record of records) for (const entry of decodeClaudeCodeLine(typeof record === "string" ? record : JSON.stringify(record))) transcript.applyEntry(entry);
	return transcript.items();
}

function writeSession(root: string, slug: string, id: string, records: unknown[]): string {
	mkdirSync(join(root, slug), { recursive: true });
	const path = join(root, slug, `${id}.jsonl`);
	writeFileSync(path, `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
	return path;
}

describe("decodeClaudeCodeLine", () => {
	test("prompts, replies, thinking, and tool calls read as omp's, and a tool result settles its call", () => {
		const items = itemsOf([
			user("u1", "fix the login"),
			assistant("a1", [
				{ type: "thinking", thinking: "", signature: "x" },
				{ type: "thinking", thinking: "Look at the form first." },
				{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls", description: "List files" } },
			]),
			user("u2", [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "no such file" }] }]),
			assistant("a2", [{ type: "text", text: "Fixed." }]),
		]);
		expect(items).toMatchObject([
			{ kind: "user", text: "fix the login" },
			{ kind: "thinking", text: "Look at the form first." },
			{ kind: "tool", id: "tool:t1", name: "Bash", status: "error" },
			{ kind: "assistant", text: "Fixed." },
		]);
	});

	test("an image the user pasted shows on the prompt", () => {
		const [prompt] = itemsOf([user("u1", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }, { type: "text", text: "what is this" }])]);
		expect(prompt).toMatchObject({ kind: "user", text: "what is this" });
		expect(prompt?.kind === "user" && prompt.images?.length).toBe(1);
	});

	test("injected context, subagent turns, and bookkeeping show nothing; a compaction shows its notice", () => {
		expect(
			itemsOf([
				user("m1", "<command-name>/clear</command-name>", { isMeta: true }),
				user("s1", "a subagent's task", { isSidechain: true }),
				{ type: "ai-title", aiTitle: "Login fix", sessionId: "c1" },
				{ type: "file-history-snapshot", messageId: "x", snapshot: {} },
				{ type: "permission-mode", permissionMode: "default" },
				{ type: "system", subtype: "informational", uuid: "y", ...base },
			]),
		).toEqual([]);
		expect(itemsOf([{ type: "system", subtype: "compact_boundary", uuid: "b1", ...base }])).toMatchObject([{ kind: "notice", level: "info" }]);
	});

	test("a record it does not know, or a line that is no JSON, shows as an unread line", () => {
		const items = itemsOf([{ type: "brand-new", uuid: "n1", ...base }, "{not json"]);
		expect(items).toMatchObject([
			{ kind: "notice", level: "warning", text: expect.stringContaining('"brand-new"') },
			{ kind: "notice", level: "warning", text: "Unread line: {not json" },
		]);
		expect(itemsOf(["{not json"])[0]?.id).toBe(items[1]?.id);
	});

	test("an unknown record whose name is an object property still warns", () => {
		expect(itemsOf([{ type: "toString", ...base }])).toMatchObject([{ kind: "notice", level: "warning" }]);
	});

	test("mixed content keeps valid text and tools alongside one unread-line warning", () => {
		const record = assistant("mixed", [
			{ type: "text", text: "Still readable." },
			{ type: "tool_use", id: "good", name: "Bash", input: { command: "pwd" } },
			{ type: "text", text: 7 },
			{ type: "new_block", text: "not silently dropped" },
			null,
		]);
		expect(itemsOf([record])).toMatchObject([
			{ kind: "assistant", text: "Still readable." },
			{ kind: "tool", id: "tool:good", name: "Bash", status: "running" },
			{ kind: "notice", level: "warning", text: expect.stringContaining('"mixed"') },
		]);
	});

	test.each([
		undefined, {}, 7,
		[{ type: "text" }], [{ type: "thinking", thinking: false }],
		[{ type: "tool_use", name: "Bash", input: {} }],
		[{ type: "tool_use", id: "c", name: "", input: {} }],
		[{ type: "tool_use", id: "c", name: "Bash", input: [] }],
		[{ type: "tool_use", id: "c", name: "Bash" }],
		[{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }],
	].map(content => ({ content })))("malformed message content produces a warning rather than an empty transcript (%j)", ({ content }) => {
		expect(itemsOf([user("bad", content)])).toMatchObject([{ kind: "notice", level: "warning" }]);
		expect(itemsOf([assistant("bad", content)])).toMatchObject([{ kind: "notice", level: "warning" }]);
	});

	test("a mixed result retains its text and settles its call while malformed correlation produces a warning", () => {
		const call = assistant("call", [{ type: "tool_use", id: "c", name: "Bash", input: { command: "pwd" } }]);
		const result = user("result", [
			{ type: "tool_result", tool_use_id: "c", content: [{ type: "text", text: "/work" }, { type: "future_result" }] },
			{ type: "tool_result", content: "uncorrelated" },
			{ type: "text", text: "Continue." },
		]);
		expect(decodeClaudeCodeLine(JSON.stringify(result))).toMatchObject([
			{ message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "/work" }] } },
			{ message: { role: "user", content: [{ type: "text", text: "Continue." }] } },
			{ type: "unread-line", text: JSON.stringify(result) },
		]);
		expect(itemsOf([call, result])).toMatchObject([
			{ kind: "tool", id: "tool:c", status: "ok" },
			{ kind: "user", text: "Continue." },
			{ kind: "notice", level: "warning" },
		]);
	});

	test("intentional empty and redacted blocks leave a valid reply without warnings", () => {
		expect(itemsOf([assistant("empty", [
			{ type: "text", text: "" }, { type: "thinking", thinking: "" }, { type: "redacted_thinking", data: "encrypted" },
			{ type: "text", text: "Done." },
		])])).toMatchObject([{ kind: "assistant", text: "Done." }]);
	});
});

describe("claudeCodeFileOf", () => {
	test("a session file one directory below the root is a session; subagent files and memory are not", () => {
		expect(claudeCodeFileOf("/claude/projects/-work/c1.jsonl", "/claude/projects")).toBe("/claude/projects/-work/c1.jsonl");
		expect(claudeCodeFileOf("/claude/projects/-work/c1/subagents/agent-1.jsonl", "/claude/projects")).toBeNull();
		expect(claudeCodeFileOf("/claude/projects/-work/memory/notes.md", "/claude/projects")).toBeNull();
		expect(claudeCodeFileOf("/elsewhere/-work/c1.jsonl", "/claude/projects")).toBeNull();
	});
});

describe("claudeCodeFormat", () => {
	test("lists each session by its newest title, else its first prompt, and flags one with no turn as empty", async () => {
		const root = mkdtempSync(join(tmpdir(), "omp-agents-claude-"));
		dirs.push(root);
		writeSession(root, "-work", "c1", [
			user("m1", "context", { isMeta: true }),
			user("u1", "fix the login"),
			{ type: "ai-title", aiTitle: "Login", sessionId: "c1" },
			{ type: "ai-title", aiTitle: "Login fix", sessionId: "c1" },
		]);
		writeSession(root, "-work", "c2", [user("u1", "add a\ntest"), assistant("a1", [{ type: "text", text: "Added." }])]);
		writeSession(root, "-work", "c3", [{ type: "permission-mode", permissionMode: "default", sessionId: "c3" }]);
		writeSession(join(root, "-work", "c2"), "subagents", "agent-1", [user("u1", "a subagent's task")]);
		const format = claudeCodeFormat(root);
		const listed = (await format.list()).toSorted((a, b) => a.id.localeCompare(b.id));
		expect(listed.map(({ id, cwd, title, empty, source }) => ({ id, cwd, title, empty, source }))).toEqual([
			{ id: "c1", cwd: "/work", title: "Login fix", empty: false, source: "claude-code" },
			{ id: "c2", cwd: "/work", title: "add a test", empty: false, source: "claude-code" },
			{ id: "c3", cwd: "", title: null, empty: true, source: "claude-code" },
		]);
	});

	test("a root that does not exist lists nothing", async () => {
		expect(await claudeCodeFormat(join(tmpdir(), "omp-agents-no-claude", "projects")).list()).toEqual([]);
	});
});
