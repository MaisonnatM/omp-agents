import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endsMidTurn } from "./sessions";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = "2026-10-01T12:00:00.000Z";
const model = { api: "anthropic-messages", provider: "anthropic", model: "claude" };
const header = { type: "session", version: 3, id: "s1", timestamp: at, cwd: "/tmp" };
const prompt = { type: "message", id: "u1", parentId: null, timestamp: at, message: { role: "user", content: "run it", timestamp: 1 } };
const toolCall = {
	type: "message",
	id: "a1",
	parentId: "u1",
	timestamp: at,
	message: { role: "assistant", ...model, content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }], stopReason: "toolUse", timestamp: 2 },
};
const killed = {
	type: "custom",
	id: "x1",
	parentId: "a1",
	timestamp: at,
	customType: "session_exit",
	data: { reason: "SIGTERM", kind: "signal", recordedAt: at },
};

function sessionFile(entries: object[]): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-omp-"));
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	writeFileSync(path, entries.map(entry => `${JSON.stringify(entry)}\n`).join(""));
	return path;
}

describe("endsMidTurn", () => {
	test("a session whose process was killed during a tool call ended mid-turn", async () => {
		expect(await endsMidTurn(sessionFile([header, prompt, toolCall, killed]))).toBe(true);
	});

	test("once omp has resumed it and recorded the abort, it no longer has", async () => {
		const abort = {
			type: "message",
			id: "a2",
			parentId: "x1",
			timestamp: at,
			message: { role: "assistant", ...model, content: [], stopReason: "aborted", timestamp: 3 },
		};
		expect(await endsMidTurn(sessionFile([header, prompt, toolCall, killed, abort]))).toBe(false);
	});
});
