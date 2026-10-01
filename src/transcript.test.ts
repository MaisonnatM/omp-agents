import { describe, expect, test } from "bun:test";
import { Transcript } from "./transcript";

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({ role: "assistant", content, ...extra });
const collabPrompt = { role: "custom", customType: "collab-prompt", content: "reply with the word pong", details: { from: "probe" } };

describe("Transcript", () => {
	test("renders a guest prompt and the streamed reply as omp 18.4 sends them", () => {
		const t = new Transcript();
		t.applyEvent({ type: "agent_start" });
		t.applyEvent({ type: "message_start", message: collabPrompt });
		t.applyEvent({ type: "message_end", message: collabPrompt });
		t.applyEvent({ type: "message_start", message: assistant([]) });
		const streaming = t.applyEvent({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "po", partial: assistant([{ type: "text", text: "po" }]) },
		});
		expect(streaming).toEqual([{ id: "live2:0", kind: "assistant", text: "po", streaming: true }]);
		t.applyEvent({ type: "message_end", message: assistant([{ type: "text", text: "pong" }], { stopReason: "stop" }) });

		expect(t.items()).toEqual([
			{ id: "live1", kind: "user", text: "reply with the word pong", from: "probe" },
			{ id: "live2:0", kind: "assistant", text: "pong", streaming: false },
		]);
	});

	test("an update without its start (joined mid-turn) still renders and ends", () => {
		const t = new Transcript();
		t.applyEvent({ type: "message_update", assistantMessageEvent: { partial: assistant([{ type: "text", text: "half" }]) } });
		t.applyEvent({ type: "message_end", message: assistant([{ type: "text", text: "half done" }]) });
		expect(t.items()).toEqual([{ id: "live1:0", kind: "assistant", text: "half done", streaming: false }]);
	});

	test("a tool call merges its content block, execution events, and result into one item", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 30 && echo done" } };
		t.applyEvent({ type: "message_start", message: assistant([call]) });
		t.applyEvent({ type: "message_end", message: assistant([call], { stopReason: "toolUse" }) });
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: call.arguments });
		t.applyEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", isError: true });
		// A later replay of the same content block must not resurrect the call as running.
		t.applyEvent({ type: "message_end", message: assistant([call]) });

		expect(t.items()).toEqual([{ id: "tool:c1", kind: "tool", name: "bash", summary: "sleep 30 && echo done", status: "error" }]);
	});

	test("a subagent's yield shows its answer, not the payload type", () => {
		const t = new Transcript();
		const call = { type: "toolCall", id: "y1", name: "yield", arguments: { type: "result", data: "done banana" } };
		t.applyEntry({ type: "message", id: "e1", message: assistant([call], { stopReason: "toolUse" }) });
		expect(t.items()).toEqual([{ id: "tool:y1", kind: "tool", name: "yield", summary: "done banana", status: "running" }]);
	});

	test("a tool cut off by an interrupt stops showing as running when the turn ends", () => {
		const t = new Transcript();
		t.applyEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: { command: "sleep 40" } });
		t.applyEvent({ type: "agent_end" });
		expect(t.items()).toEqual([{ id: "tool:c2", kind: "tool", name: "bash", summary: "sleep 40", status: "error" }]);
	});

	test("snapshot entries render prompts, replies, and settled tool calls; other custom messages stay hidden", () => {
		const t = new Transcript();
		const entries = [
			{ type: "model_change", id: "e0", model: "anthropic/claude-opus-5-5" },
			{ type: "message", id: "e1", message: { role: "user", content: [{ type: "text", text: "list files" }] } },
			{ type: "custom_message", id: "e2", customType: "skill-injection", content: "secret", display: true },
			{ type: "message", id: "e3", message: assistant([{ type: "toolCall", id: "c9", name: "read", arguments: { path: "." }, intent: "Listing files" }]) },
			{ type: "message", id: "e4", message: { role: "toolResult", toolCallId: "c9", toolName: "read", content: [], isError: false } },
			{ type: "message", id: "e5", message: assistant([{ type: "text", text: "README.md" }], { stopReason: "stop" }) },
		];
		for (const entry of entries) t.applyEntry(entry);

		expect(t.items()).toEqual([
			{ id: "e1", kind: "user", text: "list files", from: null },
			{ id: "tool:c9", kind: "tool", name: "read", summary: "Listing files", status: "ok" },
			{ id: "e5:0", kind: "assistant", text: "README.md", streaming: false },
		]);
	});
});
