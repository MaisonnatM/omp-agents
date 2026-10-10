import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchConversations, snippetOf } from "./conversation-search";
import { type ListedSession, SessionFactsIndex } from "./session-facts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const line = (role: "user" | "assistant" | "toolResult", text: string, timestamp: number): string =>
	`${JSON.stringify({ type: "message", id: `e${timestamp}`, timestamp: new Date(timestamp).toISOString(), message: { role, timestamp, content: [{ type: "text", text }] } })}\n`;

test("finds each session by its latest prompt or reply holding every word, not tool output or a subagent's, and follows what a file gains", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-convo-"));
	dirs.push(dir);
	const older = join(dir, "a.jsonl");
	const newer = join(dir, "b.jsonl");
	writeFileSync(older, line("user", "Fix the LOGIN redirect", 1) + line("assistant", "The login fix is pushed.", 2) + line("toolResult", "login fix in the logs", 3));
	writeFileSync(newer, line("user", "Write the login test", 4) + line("toolResult", "fix the login", 5));
	mkdirSync(join(dir, "b", "Child"), { recursive: true });
	writeFileSync(join(dir, "b", "Child", "sub.jsonl"), line("assistant", "fix login in the subagent", 6));
	const index = new SessionFactsIndex(async () => null, async () => null, async () => null);
	const listed = (newerAt: number): (ListedSession & { id: string })[] => [
		{ id: "b", path: newer, cwd: dir, modifiedAt: newerAt },
		{ id: "a", path: older, cwd: dir, modifiedAt: 1 },
	];
	const search = (sessions: (ListedSession & { id: string })[]) => searchConversations(sessions, path => index.conversationOf(path), "fix login");

	await index.refresh(listed(1));
	expect(search(listed(1))).toEqual([{ sessionId: "a", messageId: "m2:0", role: "assistant", snippet: "The login fix is pushed.", matches: 2 }]);

	appendFileSync(newer, line("assistant", "Then fix the login test.", 7));
	await index.refresh(listed(2));
	expect(search(listed(2)).map(hit => [hit.sessionId, hit.messageId, hit.matches])).toEqual([
		["b", "m7:0", 1],
		["a", "m2:0", 2],
	]);
});

test("a snippet is one line that starts on a word a little before the first word searched", () => {
	const snippet = snippetOf(`${"a ".repeat(60)}needle\n\nafter ${"b ".repeat(100)}`, "needle after");
	expect(snippet.startsWith("…")).toBe(true);
	expect(snippet.endsWith("…")).toBe(true);
	expect(snippet.indexOf("needle after")).toBe(17);
	expect(snippetOf("Short\nreply", "zzz")).toBe("Short reply");
	expect(snippetOf(`${"word ".repeat(20)}needle`, "needle")).toBe(`…${"word ".repeat(3)}needle`);
});
