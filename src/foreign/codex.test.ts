import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transcript } from "../transcript";
import { codexFileOf, codexFormat, decodeCodexLine } from "./codex";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = "2026-10-01T12:00:00.000Z";
const item = (payload: object) => ({ type: "response_item", timestamp: at, payload });
const say = (role: string, text: string) => item({ type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });
const meta = (id: string, source: unknown = "vscode") => ({ type: "session_meta", timestamp: at, payload: { id, cwd: "/work", source } });

/** The transcript items a file of `records` shows; a string stands for a raw line. */
function itemsOf(records: unknown[]) {
	const transcript = new Transcript();
	for (const record of records) for (const entry of decodeCodexLine(typeof record === "string" ? record : JSON.stringify(record))) transcript.applyEntry(entry);
	return transcript.items();
}

describe("decodeCodexLine", () => {
	test("prompts, replies, reasoning, and tool calls read as omp's, and an output settles its call by its exit code", () => {
		const items = itemsOf([
			meta("x1"),
			{ type: "turn_context", timestamp: at, payload: {} },
			say("developer", "You are Codex."),
			say("user", "fix the login"),
			item({ type: "reasoning", summary: [{ type: "summary_text", text: "Check the form." }] }),
			item({ type: "function_call", call_id: "c1", name: "exec_command", arguments: JSON.stringify({ cmd: "ls", workdir: "/work" }) }),
			item({ type: "function_call_output", call_id: "c1", output: "Chunk ID: 1\nWall time: 0.1 seconds\nProcess exited with code 2\nOutput:\nls: no such file" }),
			item({ type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin Patch" }),
			item({ type: "custom_tool_call_output", call_id: "c2", output: [{ type: "input_text", text: "Success." }] }),
			item({ type: "web_search_call", status: "completed", action: { type: "search", query: "bun glob" } }),
			{ type: "event_msg", timestamp: at, payload: { type: "agent_message", message: "Fixed." } },
			say("assistant", "Fixed."),
		]);
		expect(items).toMatchObject([
			{ kind: "user", text: "fix the login" },
			{ kind: "thinking", text: "Check the form." },
			{ kind: "tool", id: "tool:c1", name: "exec_command", status: "error" },
			{ kind: "tool", id: "tool:c2", name: "apply_patch", status: "ok" },
			{ kind: "tool", name: "web_search", summary: "bun glob", status: "ok" },
			{ kind: "assistant", text: "Fixed." },
		]);
	});

	test("the context Codex sends as the user's words is left out of the prompt, and a message of it alone shows nothing", () => {
		const context = { type: "input_text", text: "<environment_context>\n  <cwd>/work</cwd>\n</environment_context>" };
		expect(itemsOf([item({ type: "message", role: "user", content: [context] })])).toEqual([]);
		expect(itemsOf([item({ type: "message", role: "user", content: [context, { type: "input_text", text: "run the tests" }] })])).toMatchObject([
			{ kind: "user", text: "run the tests" },
		]);
	});

	test("a record it does not know, or a line that is no JSON, shows as an unread line", () => {
		expect(itemsOf([{ type: "brand_new", timestamp: at }, item({ type: "brand_new_item" }), "{not json"])).toMatchObject([
			{ kind: "notice", level: "warning", text: expect.stringContaining('"brand_new"') },
			{ kind: "notice", level: "warning", text: expect.stringContaining('"brand_new_item"') },
			{ kind: "notice", level: "warning", text: "Unread line: {not json" },
		]);
	});
});

describe("codexFileOf", () => {
	test("a rollout file three directories below the root is a session; anything else is not", () => {
		expect(codexFileOf("/codex/sessions/2026/10/01/rollout-a.jsonl", "/codex/sessions")).toBe("/codex/sessions/2026/10/01/rollout-a.jsonl");
		expect(codexFileOf("/codex/sessions/2026/10/01/other.jsonl", "/codex/sessions")).toBeNull();
		expect(codexFileOf("/codex/sessions/2026/10/rollout-a.jsonl", "/codex/sessions")).toBeNull();
	});
});

describe("codexFormat", () => {
	test("lists each session by its renamed title, else its first prompt, and leaves out subagents' files", async () => {
		const home = mkdtempSync(join(tmpdir(), "omp-agents-codex-"));
		dirs.push(home);
		const day = join(home, "sessions", "2026", "10", "01");
		mkdirSync(day, { recursive: true });
		const write = (name: string, records: unknown[]) => writeFileSync(join(day, name), `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
		write("rollout-2026-10-01T12-00-00-0199a000-0000-7000-8000-000000000001.jsonl", [meta("x1"), say("user", "fix the login"), say("assistant", "Fixed.")]);
		write("rollout-2026-10-01T12-05-00-0199a000-0000-7000-8000-000000000002.jsonl", [meta("x2"), say("user", "add a test")]);
		write("rollout-2026-10-01T12-10-00-0199a000-0000-7000-8000-000000000003.jsonl", [meta("x3", { subagent: { other: "guardian" } }), say("user", "review")]);
		writeFileSync(join(home, "session_index.jsonl"), `${JSON.stringify({ id: "x1", thread_name: "Login", updated_at: at })}\n${JSON.stringify({ id: "x1", thread_name: "Login fix", updated_at: at })}\n`);
		const listed = (await codexFormat(join(home, "sessions")).list()).toSorted((a, b) => a.id.localeCompare(b.id));
		expect(listed.map(({ id, cwd, title, empty, source }) => ({ id, cwd, title, empty, source }))).toEqual([
			{ id: "x1", cwd: "/work", title: "Login fix", empty: false, source: "codex" },
			{ id: "x2", cwd: "/work", title: "add a test", empty: false, source: "codex" },
		]);
	});

	test("a root that does not exist lists nothing", async () => {
		expect(await codexFormat(join(tmpdir(), "omp-agents-no-codex", "sessions")).list()).toEqual([]);
	});
});
