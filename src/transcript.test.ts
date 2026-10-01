import { describe, expect, test } from "bun:test";
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
			{ id: "m100", kind: "user", text: "say pong", from: null, entryId: "e1" },
			{ id: "m200:0", kind: "assistant", text: "pong", streaming: false },
		]);
	});

	test("a collab prompt renders from its file entry only: the entry carries no message timestamp to merge on", () => {
		const t = new Transcript();
		const prompt = { role: "custom", customType: "collab-prompt", timestamp: 300, content: "hi", details: { from: "probe" } };
		expect(t.applyEvent({ type: "message_start", message: prompt })).toEqual([]);
		t.applyEntry({ type: "custom_message", id: "e3", customType: "collab-prompt", content: "hi", details: { from: "probe" } });
		expect(t.items()).toEqual([{ id: "e3", kind: "user", text: "hi", from: "probe", entryId: null }]);
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
			{ id: "m700", kind: "user", text: "fork me", from: null, entryId: null },
		]);
		expect(t.applyEntry({ type: "message", id: "a1b2c3d4", message: prompt })).toEqual([
			{ id: "m700", kind: "user", text: "fork me", from: null, entryId: "a1b2c3d4" },
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
		expect(t.items()).toEqual([{ id: "tool:c1", kind: "tool", name: "bash", summary: "sleep 30 && echo done", status: "running" }]);

		t.applyEntry({ type: "message", id: "e2", message: { role: "toolResult", timestamp: 401, toolCallId: "c1", toolName: "bash", isError: true } });
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: call.arguments });

		expect(t.items()).toEqual([{ id: "tool:c1", kind: "tool", name: "bash", summary: "sleep 30 && echo done", status: "error" }]);
	});

	test("a subagent's yield shows its answer, not the payload type", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "y1", name: "yield", arguments: { type: "result", data: "done banana" } };
		t.applyEntry({ type: "message", id: "e1", message: assistant(500, [call], { stopReason: "toolUse" }) });
		expect(t.items()).toEqual([{ id: "tool:y1", kind: "tool", name: "yield", summary: "done banana", status: "running" }]);
	});

	test("a tool cut off by an interrupt stops showing as running when the turn ends", () => {
		const t = new Transcript();
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: { command: "sleep 40" } });
		t.applyEvent({ type: "agent_end" });
		expect(t.items()).toEqual([{ id: "tool:c2", kind: "tool", name: "bash", summary: "sleep 40", status: "error" }]);
	});

	test("file lines render prompts, replies, and settled tool calls; other custom messages stay hidden", () => {
		const t = new Transcript();
		const lines = [
			{ type: "model_change", id: "e0", model: "anthropic/claude-opus-5-5" },
			{ type: "message", id: "e1", message: { role: "user", timestamp: 1, content: [text("list files")] } },
			{ type: "custom_message", id: "e2", customType: "skill-injection", content: "secret", display: true },
			{ type: "message", id: "e3", message: assistant(2, [{ type: "toolCall", id: "c9", name: "read", arguments: { path: "." }, intent: "Listing files" }]) },
			{ type: "message", id: "e4", message: { role: "toolResult", timestamp: 3, toolCallId: "c9", toolName: "read", content: [], isError: false } },
			{ type: "message", id: "e5", message: assistant(4, [text("README.md")], { stopReason: "aborted" }) },
		].map(line => JSON.stringify(line));
		t.applyLines([...lines, "{not json", ""]);

		expect(t.items()).toEqual([
			{ id: "m1", kind: "user", text: "list files", from: null, entryId: "e1" },
			{ id: "tool:c9", kind: "tool", name: "read", summary: "Listing files", status: "ok" },
			{ id: "m4:0", kind: "assistant", text: "README.md", streaming: false },
			{ id: "m4:stop", kind: "notice", level: "warning", text: "Interrupted." },
		]);
	});
});
