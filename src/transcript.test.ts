import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillPromptMessage } from "./omp/prompts";
import { Transcript } from "./transcript";

const assistant = (timestamp: number, content: unknown[], extra: Record<string, unknown> = {}) => ({
	role: "assistant",
	timestamp,
	content,
	...extra,
});
const text = (value: string) => ({ type: "text", text: value });

describe("Transcript", () => {
	test("a streamed reply is replaced in place by its file entry, and later events cannot undo it", () => {
		const t = new Transcript();
		t.applyEntry({ type: "message", id: "e1", message: { role: "user", timestamp: 100, content: "say pong" } });
		t.applyEvent({ type: "message_start", message: assistant(200, []) });
		const streaming = t.applyEvent({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "po", partial: assistant(200, [text("po")]) },
		});
		expect(streaming).toEqual([{ id: "m200:0", kind: "assistant", text: "po", streaming: true }]);

		t.applyEntry({ type: "message", id: "e2", message: assistant(200, [text("pong")], { stopReason: "stop" }) });
		// The relay delivers the last update after the local file already has the message.
		const late = t.applyEvent({ type: "message_update", assistantMessageEvent: { partial: assistant(200, [text("pon")]) } });

		expect(late).toEqual([]);
		expect(t.items()).toEqual([
			{ id: "m100", kind: "user", text: "say pong", skill: null, from: null, entryId: "e1" },
			{ id: "m200:0", kind: "assistant", text: "pong", streaming: false },
		]);
	});

	test("a replayed message reports only what changed in it", () => {
		const t = new Transcript();
		const update = (reply: string, ...blocks: unknown[]) =>
			t.applyEvent({ type: "message_update", assistantMessageEvent: { partial: assistant(200, [text(reply), ...blocks]) } });
		const call = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } };

		expect(update("po", call).map(item => item.id)).toEqual(["m200:0", "tool:c1"]);
		expect(update("po", call)).toEqual([]);
		expect(update("pong", call)).toEqual([{ id: "m200:0", kind: "assistant", text: "pong", streaming: true }]);
		expect(t.applyEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", isError: true })).toEqual([
			{ id: "tool:c1", kind: "tool", name: "bash", summary: "ls", status: "error", agents: [] },
		]);
	});

	test("a collab prompt renders from its file entry only: the entry carries no message timestamp to merge on", () => {
		const t = new Transcript();
		const prompt = { role: "custom", customType: "collab-prompt", timestamp: 300, content: "hi", details: { from: "probe" } };
		expect(t.applyEvent({ type: "message_start", message: prompt })).toEqual([]);
		t.applyEntry({ type: "custom_message", id: "e3", customType: "collab-prompt", content: "hi", details: { from: "probe" } });
		expect(t.items()).toEqual([{ id: "e3", kind: "user", text: "hi", skill: null, from: "probe", entryId: null }]);
	});

	test("a fresh session's first prompt shows at once and stays ahead of its reply when the file catches up", () => {
		const t = new Transcript();
		const prompt = { role: "user", timestamp: 600, content: "say pong" };
		t.applyEvent({ type: "message_end", message: prompt });
		t.applyEvent({ type: "message_update", assistantMessageEvent: { partial: assistant(610, [text("po")]) } });
		expect(t.takeReordered()).toBe(false);

		// omp writes the prompt to a new session file only together with the finished reply.
		const reply = assistant(610, [text("pong")], { stopReason: "stop" });
		t.applyEntry({ type: "message", id: "e1", message: prompt });
		t.applyEntry({ type: "message", id: "e2", message: reply });
		t.applyEvent({ type: "notice", level: "info", message: "Saved." });

		expect(t.items().map(item => item.id)).toEqual(["m600", "m610:0", "notice1"]);
		expect(t.items()[1]).toEqual({ id: "m610:0", kind: "assistant", text: "pong", streaming: false });
	});

	test("a prompt omp can branch at carries its entry id once the file holds it", () => {
		const t = new Transcript();
		const prompt = { role: "user", timestamp: 700, content: "fork me" };
		expect(t.applyEvent({ type: "message_end", message: prompt })).toEqual([
			{ id: "m700", kind: "user", text: "fork me", skill: null, from: null, entryId: null },
		]);
		expect(t.applyEntry({ type: "message", id: "a1b2c3d4", message: prompt })).toEqual([
			{ id: "m700", kind: "user", text: "fork me", skill: null, from: null, entryId: "a1b2c3d4" },
		]);
	});

	test("a prompt that reaches the file after its streamed reply moves ahead of it and asks for a reset", () => {
		const t = new Transcript();
		t.applyEvent({ type: "message_update", assistantMessageEvent: { partial: assistant(610, [text("po")]) } });
		expect(t.takeReordered()).toBe(false);

		t.applyEntry({ type: "custom_message", id: "e1", customType: "collab-prompt", content: "say pong", timestamp: new Date(600).toISOString() });

		expect(t.takeReordered()).toBe(true);
		expect(t.takeReordered()).toBe(false);
		expect(t.items().map(item => item.id)).toEqual(["e1", "m610:0"]);
	});

	test("a tool call merges its content block, execution events, and result; a late start cannot reopen it", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 30 && echo done" } };
		t.applyEntry({ type: "message", id: "e1", message: assistant(400, [call], { stopReason: "toolUse" }) });
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: call.arguments });
		expect(t.items()).toEqual([{ id: "tool:c1", kind: "tool", name: "bash", summary: "sleep 30 && echo done", status: "running", agents: [] }]);

		t.applyEntry({ type: "message", id: "e2", message: { role: "toolResult", timestamp: 401, toolCallId: "c1", toolName: "bash", isError: true } });
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: call.arguments });

		expect(t.items()).toEqual([{ id: "tool:c1", kind: "tool", name: "bash", summary: "sleep 30 && echo done", status: "error", agents: [] }]);
	});

	test("a subagent's yield shows its answer, not the payload type", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "y1", name: "yield", arguments: { type: "result", data: "done banana" } };
		t.applyEntry({ type: "message", id: "e1", message: assistant(500, [call], { stopReason: "toolUse" }) });
		expect(t.items()).toEqual([{ id: "tool:y1", kind: "tool", name: "yield", summary: "done banana", status: "running", agents: [] }]);
	});

	test("a tool cut off by an interrupt stops showing as running when the turn ends", () => {
		const t = new Transcript();
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: { command: "sleep 40" } });
		t.applyEvent({ type: "agent_end" });
		expect(t.items()).toEqual([{ id: "tool:c2", kind: "tool", name: "bash", summary: "sleep 40", status: "error", agents: [] }]);
	});

	test("a task row names its subagents by the ids omp gave them, not the task names, from progress and results alike", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "k1", name: "task", arguments: { tasks: [{ name: "Fix" }, { name: "Fix" }] } };
		t.applyEntry({ type: "message", id: "e1", message: assistant(700, [call], { stopReason: "toolUse" }) });
		const details = { progress: [{ id: "Fix" }, { id: "Fix2" }], results: [{ id: "Fix2" }, { id: "Review" }] };
		t.applyEntry({ type: "message", id: "e2", message: { role: "toolResult", timestamp: 701, toolCallId: "k1", toolName: "task", details } });

		expect(t.items()).toEqual([{ id: "tool:k1", kind: "tool", name: "task", summary: "", status: "ok", agents: ["Fix", "Fix2", "Review"] }]);
	});

	test("a running task shows each subagent as its live updates name it, one at a time", () => {
		const t = new Transcript();
		const update = (id: string) => ({ type: "tool_execution_update", toolCallId: "k2", toolName: "task", partialResult: { details: { results: [], progress: [{ id }] } } });
		t.applyEvent({ type: "tool_execution_start", toolCallId: "k2", toolName: "task", args: { i: "Spawning reviewers" } });
		t.applyEvent(update("Alpha"));
		t.applyEvent(update("Beta"));
		expect(t.applyEvent(update("Alpha"))).toEqual([]);

		expect(t.items()).toEqual([{ id: "tool:k2", kind: "tool", name: "task", summary: "Spawning reviewers", status: "running", agents: ["Alpha", "Beta"] }]);
	});

	test("only a task result names subagents", () => {
		const t = new Transcript();
		t.applyEntry({ type: "message", id: "e1", message: { role: "toolResult", timestamp: 1, toolCallId: "b1", toolName: "bash", details: { results: [{ id: "x" }] } } });
		expect(t.items()).toEqual([{ id: "tool:b1", kind: "tool", name: "bash", summary: "", status: "ok", agents: [] }]);
	});

	test("a steer and a follow-up show where the agent took them, though omp stamps them when they were queued", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 60" } };
		const user = (timestamp: number, content: string) => ({ role: "user", timestamp, content });
		for (const entry of [
			{ type: "message", id: "e1", message: user(100, "sleep, then say DONE") },
			{ type: "message", id: "e2", message: assistant(101, [call], { stopReason: "toolUse" }) },
			{ type: "message", id: "e3", message: { role: "toolResult", timestamp: 110, toolCallId: "c1", toolName: "bash", isError: false } },
			{ type: "message", id: "e4", message: user(102, "steer: add apple") },
			{ type: "message", id: "e5", message: assistant(111, [text("DONE apple")], { stopReason: "stop" }) },
			{ type: "message", id: "e6", message: user(103, "follow-up: say banana") },
			{ type: "message", id: "e7", message: assistant(120, [text("banana")], { stopReason: "stop" }) },
		]) {
			t.applyEntry(entry);
		}
		expect(t.items().map(item => item.id)).toEqual(["m100", "tool:c1", "m102", "m111:0", "m103", "m120:0"]);
	});

	test("a follow-up omp starts live goes after the reply it waited on", () => {
		const t = new Transcript();
		t.applyEvent({ type: "message_end", message: assistant(111, [text("DONE")], { stopReason: "stop" }) });
		t.applyEvent({ type: "message_start", message: { role: "user", timestamp: 103, content: "follow-up: say banana" } });
		expect(t.takeReordered()).toBe(false);
		expect(t.items().map(item => item.id)).toEqual(["m111:0", "m103"]);
	});

	test("file entries render prompts, replies, and settled tool calls; other custom messages stay hidden", () => {
		const t = new Transcript();
		for (const entry of [
			{ type: "model_change", id: "e0", model: "anthropic/claude-opus-5-5" },
			{ type: "message", id: "e1", message: { role: "user", timestamp: 1, content: [text("list files")] } },
			{ type: "custom_message", id: "e2", customType: "skill-injection", content: "secret", display: true },
			{ type: "message", id: "e3", message: assistant(2, [{ type: "toolCall", id: "c9", name: "read", arguments: { path: "." }, intent: "Listing files" }]) },
			{ type: "message", id: "e4", message: { role: "toolResult", timestamp: 3, toolCallId: "c9", toolName: "read", content: [], isError: false } },
			{ type: "message", id: "e5", message: assistant(4, [text("README.md")], { stopReason: "aborted" }) },
		]) {
			t.applyEntry(entry);
		}

		expect(t.items()).toEqual([
			{ id: "m1", kind: "user", text: "list files", skill: null, from: null, entryId: "e1" },
			{ id: "tool:c9", kind: "tool", name: "read", summary: "Listing files", status: "ok", agents: [] },
			{ id: "m4:0", kind: "assistant", text: "README.md", streaming: false },
			{ id: "m4:stop", kind: "notice", level: "warning", text: "Interrupted." },
		]);
	});

	test("a skill the dashboard expanded before sending reads as the skill and the words the user typed after it", async () => {
		const baseDir = mkdtempSync(join(tmpdir(), "skill-"));
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(filePath, "---\nname: poteto-mode\ndescription: d\n---\n\n# Poteto\n\nUser: not the user's words.\n");
		const skill = { name: "poteto-mode", description: "d", filePath, baseDir };
		const sent = (await buildSkillPromptMessage(skill, { args: "do X\nand Y" })).message;
		const bare = (await buildSkillPromptMessage(skill, { args: "" })).message;
		const t = new Transcript();
		t.applyEntry({ type: "custom_message", id: "e1", customType: "collab-prompt", content: sent, details: { from: "probe" } });
		t.applyEntry({ type: "message", id: "e2", message: { role: "user", timestamp: 2, content: [text(bare)] } });

		expect(t.items()).toEqual([
			{ id: "e1", kind: "user", text: "do X\nand Y", skill: "poteto-mode", from: "probe", entryId: null },
			{ id: "m2", kind: "user", text: "", skill: "poteto-mode", from: null, entryId: "e2" },
		]);
	});

	test("a skill the user invoked in omp renders from the invocation omp records, and a subagent's hidden skill stays hidden", () => {
		const t = new Transcript();
		const details = { name: "mma-mode", path: "/s/SKILL.md", args: "fix the scroll", prompt: "/skill:mma-mode fix the scroll" };
		t.applyEntry({ type: "custom_message", id: "e1", customType: "skill-prompt", content: "[IMPORTANT: …]", display: true, attribution: "user", details });
		t.applyEntry({ type: "custom_message", id: "e2", customType: "skill-prompt", content: "body", display: false, details: { name: "mma-mode", path: "/s/SKILL.md" } });

		expect(t.items()).toEqual([{ id: "e1", kind: "user", text: "fix the scroll", skill: "mma-mode", from: null, entryId: null }]);
	});

	test("a ! command renders as the user's command and output, fenced past any backticks in it, with its failure", () => {
		const t = new Transcript();
		const run = (timestamp: number, extra: Record<string, unknown>) =>
			t.applyEntry({ type: "message", id: `e${timestamp}`, message: { role: "bashExecution", timestamp, command: "ls", output: "a\n", exitCode: 0, ...extra } });
		run(1, {});
		run(2, { command: "echo '```'", output: "```\n", exitCode: 0 });
		run(3, { output: "", exitCode: 2 });
		run(4, { output: "", exitCode: undefined, cancelled: true });

		expect(t.items().map(item => item.kind === "user" && item.text)).toEqual([
			"```sh\n$ ls\na\n```",
			"````sh\n$ echo '```'\n```\n````",
			"```sh\n$ ls\n```\n\nExit code 2.",
			"```sh\n$ ls\n```\n\nCancelled.",
		]);
	});
});
