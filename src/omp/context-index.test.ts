import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextIndex } from "./context-index";

const dirs: string[] = [];
const indexes: ContextIndex[] = [];
afterEach(() => {
	for (const index of indexes.splice(0)) index.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = "2026-10-01T12:00:00.000Z";
const model = { api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-5" };
const line = (entry: object) => `${JSON.stringify(entry)}\n`;
const header = { type: "session", version: 3, id: "s1", timestamp: at, cwd: "/code/app" };
const prompt = { type: "message", id: "u1", parentId: null, timestamp: at, message: { role: "user", content: "summarize the repository layout", timestamp: Date.parse(at) } };
const reply = (id: string, parentId: string, input: number, timestamp = at) => ({
	type: "message",
	id,
	parentId,
	timestamp,
	message: {
		role: "assistant",
		...model,
		content: [{ type: "text", text: "Done." }],
		stopReason: "stop",
		usage: { input, output: 10, cacheRead: 0, cacheWrite: 0, cost: { input: input / 1000, output: 0, cacheRead: 0, cacheWrite: 0, total: input / 1000 } },
		timestamp: Date.parse(timestamp),
	},
});

function setUp(): { index: ContextIndex; file: string } {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-context-"));
	dirs.push(root);
	mkdirSync(join(root, "-code-app"));
	const file = join(root, "-code-app", "2026-10-01T12-00-00-000Z_s1.jsonl");
	writeFileSync(file, [header, prompt, reply("a1", "u1", 5000)].map(line).join(""));
	const index = new ContextIndex(join(root, "context-sources.db"), root);
	indexes.push(index);
	return { index, file };
}

describe("ContextIndex", () => {
	test("stores each file's input and sources, which add up to it, and reads a file again once it grows", async () => {
		const { index, file } = setUp();
		await index.sync();
		let { files, sources } = index.read(null);
		expect(files).toEqual([{ sessionFile: file, cwd: "/code/app", turns: 1, input: 5000, cost: 5 }]);
		expect(sources.reduce((sum, row) => sum + row.tokens, 0)).toBeCloseTo(5000);
		expect(sources.map(row => row.source)).toContain("conversation:User prompts");

		appendFileSync(file, line(reply("a2", "a1", 7000, "2026-10-01T15:00:00.000Z")));
		await index.sync();
		({ files, sources } = index.read(null));
		expect(files[0]).toMatchObject({ turns: 2, input: 12_000 });
		expect(sources.reduce((sum, row) => sum + row.tokens, 0)).toBeCloseTo(12_000);
	});

	test("a cutoff keeps the requests made at it or later", async () => {
		const { index, file } = setUp();
		appendFileSync(file, line(reply("a2", "a1", 7000, "2026-10-01T15:00:00.000Z")));
		await index.sync();
		expect(index.read(null).files).toMatchObject([{ turns: 2, input: 12_000 }]);
		expect(index.read(Date.parse("2026-10-01T15:00:00.000Z")).files).toMatchObject([{ turns: 1, input: 7000 }]);
		expect(index.read(Date.parse("2026-10-01T15:00:00.001Z"))).toEqual({ files: [], sources: [] });
	});
});
