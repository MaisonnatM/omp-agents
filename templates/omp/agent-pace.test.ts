import { expect, setSystemTime, test } from "bun:test";
import { NUDGE, PaceNotes } from "./agent/extensions/agent-pace/notes";

const toolResults = (id: string, cached = false): { role: string; content: Array<Record<string, unknown>> } => ({
	role: "user",
	content: [{ type: "tool_result", tool_use_id: id, content: "ok", ...(cached ? { cache_control: { type: "ephemeral" } } : {}) }],
});

test("each tool-results message keeps the note it first got, so the cached prefix does not change", () => {
	setSystemTime(new Date("2026-11-20T10:00:00Z"));
	const notes = new PaceNotes();
	notes.start();
	const first = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }, toolResults("a", true)] };
	expect(notes.apply(first)).toBe(true);
	expect(first.messages[1].content.at(-1)).toEqual({ type: "text", text: `elapsed 0s. ${NUDGE}`, cache_control: { type: "ephemeral" } });
	expect(first.messages[1].content[0]).not.toHaveProperty("cache_control");
	expect(first.messages[0].content).toHaveLength(1);

	setSystemTime(new Date("2026-11-20T10:00:42Z"));
	const second = { messages: [toolResults("a"), toolResults("b", true)] };
	notes.apply(second);
	expect(second.messages[0].content.at(-1)).toEqual({ type: "text", text: `elapsed 0s. ${NUDGE}` });
	expect(second.messages[1].content.at(-1)).toMatchObject({ text: `elapsed 42s. ${NUDGE}`, cache_control: { type: "ephemeral" } });
	setSystemTime();
});
