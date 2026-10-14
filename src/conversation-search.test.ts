import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversations, snippetOf } from "./conversation-search";
import { claudeCodeFormat } from "./foreign/claude-code";
import { type ListedSession, SessionFactsIndex } from "./session-facts";
import { ompFormat } from "./session-formats";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const line = (role: "user" | "assistant" | "toolResult", text: string, timestamp: number): string =>
	`${JSON.stringify({ type: "message", id: `e${timestamp}`, timestamp: new Date(timestamp).toISOString(), message: { role, timestamp, content: [{ type: "text", text }] } })}\n`;

test("finds each session by its latest prompt or reply holding every word, not tool output or a subagent's, and follows appends, rewrites, and unlisting", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-convo-"));
	dirs.push(dir);
	const older = join(dir, "a.jsonl");
	const newer = join(dir, "b.jsonl");
	writeFileSync(older, line("user", "Fix the LOGIN redirect", 1) + line("assistant", "The login fix is pushed.", 2) + line("toolResult", "login fix in the logs", 3));
	writeFileSync(newer, line("user", "Write the login test", 4) + line("toolResult", "fix the login", 5));
	mkdirSync(join(dir, "b", "Child"), { recursive: true });
	writeFileSync(join(dir, "b", "Child", "sub.jsonl"), line("assistant", "fix login in the subagent", 6));
	const conversations = new Conversations();
	const index = new SessionFactsIndex(async () => null, async () => null, async () => null, [conversations]);
	const listed = (newerAt: number, olderAt = 1): (ListedSession & { id: string })[] => [
		{ id: "b", path: newer, cwd: dir, modifiedAt: newerAt },
		{ id: "a", path: older, cwd: dir, modifiedAt: olderAt },
	];
	const search = (sessions: (ListedSession & { id: string })[]) => conversations.search(sessions, "fix login");

	await index.refresh(listed(1));
	expect(search(listed(1))).toEqual([{ sessionId: "a", messageId: "m2:0", role: "assistant", snippet: "The login fix is pushed.", matches: 2 }]);

	appendFileSync(newer, line("assistant", "Then fix the login test.", 7));
	await index.refresh(listed(2));
	expect(search(listed(2)).map(hit => [hit.sessionId, hit.messageId, hit.matches])).toEqual([
		["b", "m7:0", 1],
		["a", "m2:0", 2],
	]);

	writeFileSync(older, line("user", "Fix login", 8));
	await index.refresh(listed(2, 3));
	expect(search(listed(2)).map(hit => [hit.sessionId, hit.messageId, hit.matches])).toEqual([
		["b", "m7:0", 1],
		["a", "m8", 1],
	]);

	await index.refresh([listed(2)[0]!]);
	expect(search(listed(2)).map(hit => hit.sessionId)).toEqual(["b"]);
});

test("finds a Claude Code session by its prompt, under the item id its pane shows, and not by a tool's output", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-convo-"));
	dirs.push(dir);
	const root = join(dir, "claude");
	mkdirSync(join(root, "-work"), { recursive: true });
	const path = join(root, "-work", "c1.jsonl");
	const record = (uuid: string, role: "user" | "assistant", content: unknown) => `${JSON.stringify({ type: role, uuid, sessionId: "c1", timestamp: "2026-10-01T12:00:00.000Z", message: { role, content } })}\n`;
	writeFileSync(path, record("u1", "user", "Fix the login redirect") + record("u2", "user", [{ type: "tool_result", tool_use_id: "t1", content: "fix login in the logs" }]));
	const conversations = new Conversations([ompFormat(join(dir, "omp")), claudeCodeFormat(root)]);
	const index = new SessionFactsIndex(async () => null, async () => null, async () => null, [conversations]);
	const sessions = [{ id: "c1", path, cwd: dir, modifiedAt: 1 }];
	await index.refresh(sessions);
	expect(conversations.search(sessions, "fix login")).toEqual([{ sessionId: "c1", messageId: "u1", role: "user", snippet: "Fix the login redirect", matches: 1 }]);
});

test("a snippet is one line that starts on a word a little before the first word searched", () => {
	const snippet = snippetOf(`${"a ".repeat(60)}needle\n\nafter ${"b ".repeat(100)}`, "needle after");
	expect(snippet.startsWith("…")).toBe(true);
	expect(snippet.endsWith("…")).toBe(true);
	expect(snippet.indexOf("needle after")).toBe(17);
	expect(snippetOf("Short\nreply", "zzz")).toBe("Short reply");
	expect(snippetOf(`${"word ".repeat(20)}needle`, "needle")).toBe(`…${"word ".repeat(3)}needle`);
});
