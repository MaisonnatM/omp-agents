import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationSearch, snippetOf } from "./conversation-search";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const line = (role: "user" | "assistant" | "toolResult", text: string, timestamp: number): string =>
	`${JSON.stringify({ type: "message", id: `e${timestamp}`, timestamp: new Date(timestamp).toISOString(), message: { role, timestamp, content: [{ type: "text", text }] } })}\n`;

test("finds each conversation by its latest prompt or reply holding every word, reads only what a file gained, and drops a file no longer listed", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-convo-"));
	dirs.push(dir);
	const older = join(dir, "a.jsonl");
	const newer = join(dir, "b.jsonl");
	writeFileSync(older, line("user", "Fix the LOGIN redirect", 1) + line("assistant", "The login fix is pushed.", 2) + line("toolResult", "login fix in the logs", 3));
	writeFileSync(newer, line("user", "Write the login test", 4) + line("toolResult", "fix the login", 5));
	const search = new ConversationSearch();
	const sessions = [
		{ id: "b", path: newer, modifiedAt: 1 },
		{ id: "a", path: older, modifiedAt: 1 },
	];

	expect(await search.search(sessions, "fix login")).toEqual([{ sessionId: "a", messageId: "m2:0", role: "assistant", snippet: "The login fix is pushed.", matches: 2 }]);

	appendFileSync(newer, line("assistant", "Then fix the login test.", 6));
	expect(await search.search(sessions, "fix login")).toEqual([{ sessionId: "a", messageId: "m2:0", role: "assistant", snippet: "The login fix is pushed.", matches: 2 }]);
	const grown = [{ ...sessions[0]!, modifiedAt: 2 }, sessions[1]!];
	expect((await search.search(grown, "fix login")).map(hit => [hit.sessionId, hit.messageId, hit.matches])).toEqual([
		["b", "m6:0", 1],
		["a", "m2:0", 2],
	]);

	expect((await search.search([grown[0]!], "redirect")).map(hit => hit.sessionId)).toEqual([]);
});

test("a snippet is one line that starts a little before the first word searched", () => {
	const text = `${"a ".repeat(60)}needle\n\nafter ${"b ".repeat(100)}`;
	const snippet = snippetOf(text, "needle after");
	expect(snippet.startsWith("…")).toBe(true);
	expect(snippet.endsWith("…")).toBe(true);
	expect(snippet).toContain("needle after");
	expect(snippet.indexOf("needle")).toBe(17);
	expect(snippetOf("Short\nreply", "zzz")).toBe("Short reply");
	expect(snippetOf(`${"word ".repeat(20)}needle`, "needle")).toBe(`…${"word ".repeat(3)}needle`);
});
