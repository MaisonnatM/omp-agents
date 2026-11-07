import { expect, test } from "bun:test";
import sessionVisuals, { CURSOR_TOOLS_PROMPT } from "./session-visuals-extension";

function promptFor(model: { api: string } | undefined): string[] {
	let handler: ((event: { systemPrompt: string[] }, ctx: { model?: { api: string } }) => { systemPrompt: string[] }) | undefined;
	sessionVisuals({ on: (_event, registered) => void (handler = registered) });
	return handler!({ systemPrompt: ["base"] }, { model }).systemPrompt;
}

test("a Cursor model's turn learns where the dashboard's tools are; any other model's does not", () => {
	const cursor = promptFor({ api: "cursor-agent" });
	expect(cursor[0]).toBe("base");
	expect(cursor.at(-1)).toBe(CURSOR_TOOLS_PROMPT);
	for (const other of [{ api: "anthropic-messages" }, { api: "openai-completions" }, undefined]) {
		const prompt = promptFor(other);
		expect(prompt[0]).toBe("base");
		expect(prompt).toHaveLength(2);
		expect(prompt).not.toContain(CURSOR_TOOLS_PROMPT);
	}
});
