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

	test("mixed message and reasoning blocks keep known content with one warning per line", () => {
		expect(itemsOf([
			item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Readable." }, { type: "output_text", text: 7 }, { type: "new_block" }] }),
			item({ type: "reasoning", summary: [{ type: "summary_text", text: "Think." }, { type: "new_summary", text: "unknown" }] }),
		])).toMatchObject([
			{ kind: "assistant", text: "Readable." }, { kind: "notice", level: "warning" },
			{ kind: "thinking", text: "Think." }, { kind: "notice", level: "warning" },
		]);
	});

	test.each([
		{ type: "message", role: "user" },
		{ type: "message", role: "assistant", content: {} },
		{ type: "message", role: "assistant", content: [{ type: "output_text" }] },
		{ type: "function_call", name: "exec", arguments: "{}" },
		{ type: "function_call", call_id: "c", name: "", arguments: "{}" },
		{ type: "function_call", call_id: "c", name: "exec" },
		{ type: "function_call", call_id: "c", name: "exec", arguments: 7 },
		{ type: "custom_tool_call", call_id: "c", name: "patch", input: false },
		{ type: "function_call_output", output: "uncorrelated" },
		{ type: "custom_tool_call_output", call_id: "", output: "uncorrelated" },
		{ type: "web_search_call", status: "completed" },
		{ type: "tool_search_call", call_id: "", arguments: "{}" },
		{ type: "tool_search_output", output: "uncorrelated" },
		{ type: "reasoning", summary: {} },
		{ type: "reasoning", summary: null, encrypted_content: "encrypted" },
		{ type: "toString" },
	])("malformed known items produce a warning (%j)", payload => {
		expect(itemsOf([item(payload)])).toMatchObject([{ kind: "notice", level: "warning" }]);
	});

	test("a tool search output retains its discovered tools", () => {
		const result = item({ type: "tool_search_output", call_id: "search", tools: [{ type: "function", name: "exec", description: "Run a command" }] });
		expect(decodeCodexLine(JSON.stringify(result))).toMatchObject([
			{ message: { role: "toolResult", toolCallId: "search", content: [{ type: "text", text: '[{"type":"function","name":"exec","description":"Run a command"}]' }] } },
		]);
		expect(itemsOf([
			item({ type: "tool_search_call", call_id: "search", arguments: "{\"query\":\"exec\"}", status: "completed" }), result,
		])).toMatchObject([{ kind: "tool", id: "tool:search", name: "tool_search", status: "ok" }]);
	});

	test("namespaces qualify function names and mixed outputs preserve text and images with a warning", () => {
		const call = item({ type: "function_call", call_id: "c", namespace: "functions", name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" });
		const result = item({ type: "function_call_output", call_id: "c", output: { success: false, content: [
			{ type: "input_text", text: "/work" },
			{ type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
			{ type: "unknown_output", text: "unknown" },
		] } });
		expect(decodeCodexLine(JSON.stringify(result))).toMatchObject([
			{ message: { role: "toolResult", toolCallId: "c", isError: true, content: [
				{ type: "text", text: "/work" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
			] } },
			{ type: "unread-line", text: JSON.stringify(result) },
		]);
		expect(itemsOf([call, result])).toMatchObject([
			{ kind: "tool", id: "tool:c", name: "functions.exec_command", status: "error" },
			{ kind: "notice", level: "warning" },
		]);
	});

	test("unknown output warns without losing the correlated tool", () => {
		expect(itemsOf([
			item({ type: "custom_tool_call", call_id: "c", name: "patch", input: "" }),
			item({ type: "custom_tool_call_output", call_id: "c", output: { future_output: "unknown" } }),
		])).toMatchObject([{ kind: "tool", id: "tool:c", status: "ok" }, { kind: "notice", level: "warning" }]);
	});

	test("empty text, injected context, and encrypted reasoning do not warn on a readable turn", () => {
		expect(itemsOf([
			item({ type: "reasoning", summary: [], content: null, encrypted_content: "encrypted" }),
			item({ type: "message", role: "user", content: [{ type: "input_text", text: "" }, { type: "input_text", text: "<environment_context>injected</environment_context>" }] }),
			say("assistant", "Done."),
		])).toMatchObject([{ kind: "assistant", text: "Done." }]);
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
