import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claudeCodeFormat } from "./claude-code";
import { codexFormat } from "./codex";
import { ForeignUsage, type Pricer } from "./usage";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-foreign-usage-"));
	dirs.push(dir);
	return dir;
}

function write(path: string, records: unknown[]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, records.map(record => JSON.stringify(record)).join("\n") + "\n");
}

const at = "2026-10-01T12:00:00.000Z";
const timestamp = Date.parse(at);
const claude = (id: string, output: number, model = "claude-test") => ({
	type: "assistant", timestamp: at, cwd: "/work/claude", sessionId: "parent",
	message: { id, model, usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 25 } } },
});
const meta = (id: string, source: unknown = "vscode", extra: object = {}) => ({ type: "session_meta", payload: { id, cwd: "/work/codex", source, ...extra } });
const tokenCount = (total: number, input: number, cached: number, output: number) => ({
	type: "event_msg", timestamp: at, payload: { type: "token_count", info: {
		total_token_usage: { total_tokens: total },
		last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: output - 1, total_tokens: input + output },
	} },
});
const usageRecord = (responseId: string, input: number, cached: number, output: number, cacheWrite = 0) => ({
	type: "token_usage_record", timestamp: at, payload: {
		response_id: responseId,
		usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: cacheWrite, output_tokens: output, total_tokens: input + output },
		thread_token_usage: { total_tokens: input + output },
	},
});

const price: Pricer = (_provider, _model, { input, output, cacheRead, cacheWrite }) => (input + output + cacheRead + cacheWrite) / 100;

describe("ForeignUsage", () => {
	test("Claude requests use the last line per id, keep cache lifetimes for pricing, skip synthetic replies, and fold only appended complete lines", async () => {
		const dir = root();
		const path = join(dir, "project", "parent.jsonl");
		write(path, [claude("one", 1), claude("one", 2), claude("one", 3), claude("local", 0, "<synthetic>"), { type: "cost-state", totalCost: 999 }]);
		const priced: unknown[] = [];
		const index = new ForeignUsage([claudeCodeFormat(dir)], (provider, model, tokens, time) => {
			priced.push({ provider, model, tokens, time });
			return price(provider, model, tokens, time);
		});
		const [file] = await index.read();
		expect({ sessionId: file!.sessionId, subagent: file!.subagent, cwd: file!.cwd, requests: [...file!.requests] }).toEqual({
			sessionId: "parent", subagent: false, cwd: "/work/claude",
			requests: [{ provider: "anthropic", model: "claude-test", timestamp, failed: false, input: 10, output: 3, cacheRead: 20, cacheWrite: 30, cost: 0.63 }],
		});
		expect(priced).toEqual([1, 2, 3].map(output => ({ provider: "anthropic", model: "claude-test", tokens: { input: 10, output, cacheRead: 20, cacheWrite: 30, cttl: { ephemeral5m: 5, ephemeral1h: 25 } }, time: timestamp })));
		await index.read();
		expect(priced.length).toBe(3);
		const next = JSON.stringify(claude("two", 4));
		appendFileSync(path, next.slice(0, 30));
		await index.read();
		expect(priced.length).toBe(3);
		appendFileSync(path, next.slice(30) + "\n" + JSON.stringify(claude("one", 9)) + "\n");
		const [updated] = await index.read();
		expect([...updated!.requests].map(({ output, cost }) => [output, cost])).toEqual([[9, 0.69], [4, 0.64]]);
		expect(priced.length).toBe(5);
	});

	test("a Claude subagent belongs to its parent; discovery, truncation, and deletion refresh the index", async () => {
		const dir = root();
		const parent = join(dir, "project", "parent.jsonl");
		const child = join(dir, "project", "parent", "subagents", "agent-one.jsonl");
		write(parent, [claude("one", 100)]);
		const index = new ForeignUsage([claudeCodeFormat(dir)], price);
		await index.read();
		write(parent, [claude("two", 1)]);
		write(child, [claude("child", 2)]);
		const files = await index.read();
		expect(files.map(file => ({ sessionId: file.sessionId, subagent: file.subagent, outputs: [...file.requests].map(request => request.output) })).sort((a, b) => Number(a.subagent) - Number(b.subagent))).toEqual([
			{ sessionId: "parent", subagent: false, outputs: [1] }, { sessionId: "parent", subagent: true, outputs: [2] },
		]);
		rmSync(child);
		expect((await index.read()).map(file => ({ subagent: file.subagent, outputs: [...file.requests].map(request => request.output) }))).toEqual([{ subagent: false, outputs: [1] }]);
	});

	test("Codex counts growing totals once, splits cached input, uses the latest model, and leaves reasoning inside output", async () => {
		const dir = root();
		const path = join(dir, "2026", "10", "01", "rollout-main.jsonl");
		write(path, [
			meta("codex-main"), { type: "turn_context", payload: { model: "model-one" } }, tokenCount(110, 100, 40, 10), tokenCount(110, 100, 40, 10),
			{ type: "event_msg", payload: { type: "token_count", info: null } },
			{ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: "model-two" } } }, tokenCount(330, 200, 150, 20),
		]);
		const index = new ForeignUsage([codexFormat(dir)], price);
		const [file] = await index.read();
		expect({ sessionId: file!.sessionId, subagent: file!.subagent, cwd: file!.cwd, requests: [...file!.requests] }).toEqual({
			sessionId: "codex-main", subagent: false, cwd: "/work/codex", requests: [
				{ provider: "openai", model: "model-one", timestamp, failed: false, input: 60, output: 10, cacheRead: 40, cacheWrite: 0, cost: 1.1 },
				{ provider: "openai", model: "model-two", timestamp, failed: false, input: 50, output: 20, cacheRead: 150, cacheWrite: 0, cost: 2.2 },
			],
		});
		await index.read();
		appendFileSync(path, JSON.stringify(tokenCount(330, 200, 150, 20)) + "\n" + JSON.stringify({ type: "turn_context", payload: { model: "model-three" } }) + "\n" + JSON.stringify(tokenCount(340, 9, 2, 1)) + "\n");
		const [updated] = await index.read();
		expect([...updated!.requests].map(({ model, input, output, cacheRead }) => ({ model, input, output, cacheRead }))).toEqual([
			{ model: "model-one", input: 60, output: 10, cacheRead: 40 }, { model: "model-two", input: 50, output: 20, cacheRead: 150 }, { model: "model-three", input: 7, output: 1, cacheRead: 2 },
		]);
	});

	test("Codex pairs response records with ordinary summaries without sharing their cumulative baseline", async () => {
		const dir = root();
		const path = join(dir, "2026", "10", "01", "rollout-dual.jsonl");
		write(path, [
			meta("dual"), { type: "turn_context", payload: { model: "record-model" } },
			tokenCount(4884617, 100, 40, 10),
			usageRecord("first", 185077, 18432, 93),
			{ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c", output: "Done." } },
			tokenCount(5069787, 185077, 18432, 93), tokenCount(5069787, 185077, 18432, 93),
			usageRecord("first", 185077, 18432, 93),
			usageRecord("second", 185207, 184960, 158), tokenCount(5255152, 185207, 184960, 158),
		]);
		const [file] = await new ForeignUsage([codexFormat(dir)], price).read();
		expect([...file!.requests]).toEqual([
			{ provider: "openai", model: "record-model", timestamp, failed: false, input: 60, output: 10, cacheRead: 40, cacheWrite: 0, cost: 1.1 },
			{ provider: "openai", model: "record-model", timestamp, failed: false, input: 166645, output: 93, cacheRead: 18432, cacheWrite: 0, cost: 1851.7 },
			{ provider: "openai", model: "record-model", timestamp, failed: false, input: 247, output: 158, cacheRead: 184960, cacheWrite: 0, cost: 1853.65 },
		]);
	});

	test("Codex counts record-only compaction and continues counting future event-only requests", async () => {
		const dir = root();
		const path = join(dir, "2026", "10", "01", "rollout-compact.jsonl");
		write(path, [
			meta("compact"), { type: "turn_context", payload: { model: "before" } }, tokenCount(10173298, 100, 40, 10),
			usageRecord("compact-response", 225099, 222592, 5485),
			{ type: "compacted", payload: { message: "Summary" } }, tokenCount(10173298, 0, 0, 0),
			{ type: "turn_context", payload: { model: "after" } }, tokenCount(10403882, 225099, 222592, 5485),
		]);
		const [file] = await new ForeignUsage([codexFormat(dir)], price).read();
		expect([...file!.requests].map(({ model, input, cacheRead, output, cost }) => ({ model, input, cacheRead, output, cost }))).toEqual([
			{ model: "before", input: 60, cacheRead: 40, output: 10, cost: 1.1 },
			{ model: "before", input: 2507, cacheRead: 222592, output: 5485, cost: 2305.84 },
			{ model: "after", input: 2507, cacheRead: 222592, output: 5485, cost: 2305.84 },
		]);
	});

	test("Codex counts equal-usage distinct responses and does not re-arm a pair on duplicate response ids", async () => {
		const dir = root();
		const path = join(dir, "2026", "10", "01", "rollout-equal.jsonl");
		write(path, [
			meta("equal"), { type: "turn_context", payload: { model: "same" } },
			usageRecord("one", 100, 40, 10), usageRecord("one", 100, 40, 10), tokenCount(110, 100, 40, 10),
			usageRecord("two", 100, 40, 10), tokenCount(220, 100, 40, 10),
			usageRecord("two", 100, 40, 10), tokenCount(330, 100, 40, 10), tokenCount(330, 100, 40, 10),
		]);
		const [file] = await new ForeignUsage([codexFormat(dir)], price).read();
		expect([...file!.requests].map(({ input, output, cacheRead, cost }) => [input, output, cacheRead, cost])).toEqual([
			[60, 10, 40, 1.1], [60, 10, 40, 1.1], [60, 10, 40, 1.1],
		]);
	});

	test("Codex keeps pending response pairing across incremental reads and preserves record model and cache writes", async () => {
		const dir = root();
		const path = join(dir, "2026", "10", "01", "rollout-append.jsonl");
		write(path, [meta("append"), { type: "turn_context", payload: { model: "record-model" } }, tokenCount(110, 100, 40, 10)]);
		const index = new ForeignUsage([codexFormat(dir)], price);
		await index.read();
		const record = JSON.stringify(usageRecord("record", 200, 100, 20, 30));
		appendFileSync(path, record.slice(0, 35));
		expect([...(await index.read())[0]!.requests].map(request => request.output)).toEqual([10]);
		appendFileSync(path, record.slice(35) + "\n");
		expect([...(await index.read())[0]!.requests].map(request => request.output)).toEqual([10, 20]);
		appendFileSync(path, JSON.stringify({ type: "turn_context", payload: { model: "event-model" } }) + "\n" + JSON.stringify(tokenCount(330, 200, 100, 20)) + "\n" + JSON.stringify(tokenCount(440, 100, 40, 10)) + "\n");
		const [file] = await index.read();
		expect([...file!.requests]).toEqual([
			{ provider: "openai", model: "record-model", timestamp, failed: false, input: 60, output: 10, cacheRead: 40, cacheWrite: 0, cost: 1.1 },
			{ provider: "openai", model: "record-model", timestamp, failed: false, input: 70, output: 20, cacheRead: 100, cacheWrite: 30, cost: 2.2 },
			{ provider: "openai", model: "event-model", timestamp, failed: false, input: 60, output: 10, cacheRead: 40, cacheWrite: 0, cost: 1.1 },
		]);
	});

	test("Codex spawned and guardian subagents belong to their parent, and only an unnamed parent keeps its own unlisted id", async () => {
		const dir = root();
		const cases = [
			{ name: "spawn", source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } }, extra: {} },
			{ name: "guardian", source: { subagent: { other: "guardian" } }, extra: { parent_thread_id: "parent" } },
			{ name: "orphan", source: { subagent: { other: "guardian" } }, extra: {} },
		];
		for (const { name, source, extra } of cases) write(join(dir, "2026", "10", "01", `rollout-${name}.jsonl`), [meta(name, source, extra), meta("copied-parent"), { type: "turn_context", payload: { model: "review" } }, tokenCount(15, 10, 2, 5)]);
		const files = await new ForeignUsage([codexFormat(dir)], price).read();
		expect(files.map(file => ({ id: file.sessionId, subagent: file.subagent, outputs: [...file.requests].map(request => request.output) })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
			{ id: "orphan", subagent: true, outputs: [5] }, { id: "parent", subagent: true, outputs: [5] }, { id: "parent", subagent: true, outputs: [5] },
		]);
	});
});
