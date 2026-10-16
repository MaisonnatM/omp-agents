import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenUsage, Turn, TurnStep } from "./shared/trajectory";
import { Trajectory, TrajectoryTail } from "./trajectory";

let clock = Date.parse("2026-10-14T09:00:00.000Z");
const at = (): string => new Date((clock += 1000)).toISOString();

/** An assistant message's or a `model_usage` entry's `usage`, as omp writes it. */
interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number): Usage => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	totalTokens: input + output + cacheRead + cacheWrite,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

const user = (id: string, text: string) => ({ type: "message", id, timestamp: at(), message: { role: "user", content: [{ type: "text", text }], attribution: "user", timestamp: clock } });
const skillPrompt = (id: string, name: string, args: string, body: string, attribution = "user") => ({
	type: "custom_message",
	id,
	timestamp: at(),
	customType: "skill-prompt",
	content: body,
	display: true,
	details: { name, path: `/skills/${name}/SKILL.md`, args, prompt: body },
	attribution,
});
const notice = (customType: string, text: string) => ({ type: "custom_message", id: `n-${clock}`, timestamp: at(), customType, content: text, display: false, attribution: "agent" });
const assistant = (content: unknown[], use: Usage, stopReason = "toolUse") => ({
	type: "message",
	id: `a-${clock}`,
	timestamp: at(),
	message: { role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", usage: use, stopReason, duration: 1200, timestamp: clock },
});
const toolCall = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const started = (toolCallId: string, startedAt: string) => ({ type: "custom", id: `s-${toolCallId}`, timestamp: startedAt, customType: "tool_execution_start", data: { toolCallId, toolName: "read", startedAt } });
const result = (toolCallId: string, timestamp: string, content: unknown[], isError = false) => ({
	type: "message",
	id: `r-${toolCallId}`,
	timestamp,
	message: { role: "toolResult", toolCallId, toolName: "read", content, isError, timestamp: Date.parse(timestamp) },
});
const sideCall = (use: Usage) => ({ type: "model_usage", id: `u-${clock}`, timestamp: at(), purpose: "auto-thinking", api: "anthropic-messages", provider: "anthropic", model: "claude-haiku-5-5", usage: use, stopReason: "stop" });

function fold(...entries: unknown[]): Turn[] {
	const trajectory = new Trajectory();
	for (const entry of entries) trajectory.applyEntry(entry);
	return trajectory.turns();
}

const kinds = (turn: Turn | undefined): string[] => turn?.steps.map(step => (step.kind === "injection" ? `injection:${step.source}` : step.kind)) ?? [];
const toolStep = (turn: Turn | undefined): Extract<TurnStep, { kind: "tool" }> | undefined => turn?.steps.find(step => step.kind === "tool");

describe("Trajectory", () => {
	test("each prompt the transcript shows opens a turn: a typed message, a steering message, and a /skill: prompt; a subagent's skill does not", () => {
		const turns = fold(
			user("p1", "first"),
			assistant([{ type: "text", text: "ok" }], usage(1, 2, 0, 0, 0), "stop"),
			skillPrompt("p2", "review", "the branch", "Review skill body"),
			assistant([{ type: "text", text: "reviewing" }], usage(1, 2, 0, 0, 0), "stop"),
			skillPrompt("hidden", "writer", "", "Subagent skill body", "agent"),
			user("p3", "steer"),
		);
		expect(turns.map(turn => turn.id)).toEqual(["p1", "p2", "p3"]);
		expect(turns.map(turn => turn.index)).toEqual([1, 2, 3]);
		expect(kinds(turns[2])).toEqual(["injection:skill-prompt", "prompt"]);
	});

	test("a prompt the dashboard sent opens no turn and reaches the model as an omp-agents injection", () => {
		const turns = fold(
			user("p1", "first"),
			assistant([{ type: "text", text: "Started w1." }], usage(1, 2, 0, 0, 0), "stop"),
			user("u1", "[omp-agents] Project update.\n- w1 stopped."),
			assistant([{ type: "text", text: "w1 is done." }], usage(1, 2, 0, 0, 0), "stop"),
		);
		expect(turns.map(turn => turn.id)).toEqual(["p1"]);
		expect(kinds(turns[0])).toEqual(["prompt", "request", "reply", "injection:omp-agents", "request", "reply"]);
	});

	test("a /skill: prompt's turn shows what the user typed, then the skill's body as an injection", () => {
		const [turn] = fold(skillPrompt("p1", "mma-mode", "fix the bug", "Full skill instructions"));
		expect(turn?.steps).toEqual([
			{ kind: "prompt", body: { text: "fix the bug", cut: 0 }, skill: "mma-mode" },
			{ kind: "injection", source: "skill-prompt", attribution: "user", body: { text: "Full skill instructions", cut: 0 } },
		]);
	});

	test("a turn's usage sums its requests and side calls, and a side call between turns counts toward the next prompt's turn", () => {
		const turns = fold(
			user("p1", "one"),
			sideCall(usage(4, 3, 0, 1185, 0.125)),
			assistant([toolCall("c1", "read", { path: "a" })], usage(10, 20, 300, 40, 0.5)),
			assistant([{ type: "text", text: "done" }], usage(1, 2, 330, 3, 0.25), "stop"),
			sideCall(usage(4, 3, 0, 1185, 0.125)),
			user("p2", "two"),
			assistant([{ type: "text", text: "two" }], usage(5, 6, 7, 8, 1), "stop"),
		);
		const expected: TokenUsage[] = [
			{ input: 15, output: 25, cacheRead: 630, cacheWrite: 1228, cost: 0.875 },
			{ input: 9, output: 9, cacheRead: 7, cacheWrite: 1193, cost: 1.125 },
		];
		expect(turns.map(turn => turn.usage)).toEqual(expected);
		expect(turns.map(turn => [turn.requests, turn.toolCalls])).toEqual([
			[2, 1],
			[1, 0],
		]);
	});

	test("model and thinking changes and injected notices between turns lead the next turn, ahead of its prompt", () => {
		const turns = fold(
			user("p1", "one"),
			assistant([{ type: "text", text: "a" }], usage(1, 1, 0, 0, 0), "stop"),
			{ type: "model_change", id: "m", timestamp: at(), model: "openai/gpt-6", role: "default" },
			{ type: "thinking_level_change", id: "t", timestamp: at(), thinkingLevel: "high", configured: "high" },
			notice("xdev-mount-notice", "<system-notice>tools changed</system-notice>"),
			user("p2", "two"),
			assistant([{ type: "text", text: "b" }], usage(1, 1, 0, 0, 0), "stop"),
		);
		expect(kinds(turns[0])).toEqual(["prompt", "request", "reply"]);
		expect(turns[1]?.steps.slice(0, 4)).toEqual([
			{ kind: "model", model: "openai/gpt-6", role: "default" },
			{ kind: "thinking-level", level: "high" },
			{ kind: "injection", source: "xdev-mount-notice", attribution: "agent", body: { text: "<system-notice>tools changed</system-notice>", cut: 0 } },
			{ kind: "prompt", body: { text: "two", cut: 0 }, skill: null },
		]);
	});

	test("a notice that arrives mid-turn, such as a system reminder, stays in that turn before the request that read it", () => {
		const turns = fold(
			user("p1", "one"),
			assistant([toolCall("c1", "read", {})], usage(1, 1, 0, 0, 0)),
			{ type: "message", id: "d", timestamp: at(), message: { role: "developer", content: "<system-reminder>todo</system-reminder>", attribution: "agent" } },
			assistant([{ type: "text", text: "done" }], usage(1, 1, 0, 0, 0), "stop"),
		);
		expect(turns).toHaveLength(1);
		expect(kinds(turns[0])).toEqual(["prompt", "request", "tool", "injection:developer", "request", "reply"]);
	});

	test("a tool call shows its arguments, then its result's size in UTF-8 bytes and its duration from omp's start marker", () => {
		const turns = fold(
			user("p1", "one"),
			assistant([{ type: "thinking", thinking: "look" }, toolCall("c1", "read", { path: "a.ts" })], usage(1, 1, 0, 0, 0)),
			started("c1", "2026-10-14T10:00:00.000Z"),
			result("c1", "2026-10-14T10:00:02.500Z", [{ type: "text", text: "héllo" }, { type: "image", data: "AA==", mimeType: "image/png" }]),
		);
		expect(kinds(turns[0])).toEqual(["prompt", "request", "thinking", "tool"]);
		expect(toolStep(turns[0])).toEqual({
			kind: "tool",
			callId: "c1",
			name: "read",
			args: { text: '{\n  "path": "a.ts"\n}', cut: 0 },
			status: "ok",
			resultBytes: 6,
			resultImages: 1,
			durationMs: 2500,
		});
	});

	test("a tool call without a result is running, and one that failed is an error with no duration when omp marked no start", () => {
		const running = fold(user("p1", "one"), assistant([toolCall("c1", "read", {})], usage(1, 1, 0, 0, 0)));
		expect(toolStep(running[0])).toMatchObject({ status: "running", resultBytes: null, durationMs: null });
		const failed = fold(user("p1", "one"), assistant([toolCall("c1", "read", {})], usage(1, 1, 0, 0, 0)), result("c1", at(), [{ type: "text", text: "nope" }], true));
		expect(toolStep(failed[0])).toMatchObject({ status: "error", resultBytes: 4, durationMs: null });
	});

	test("requests made before any prompt fall in a turn without a prompt", () => {
		const turns = fold(assistant([{ type: "text", text: "hello" }], usage(1, 2, 3, 4, 0.5), "stop"), user("p1", "one"));
		expect(turns.map(turn => [turn.id, kinds(turn)[0]])).toEqual([
			["start", "request"],
			["p1", "prompt"],
		]);
	});

	test("a long text keeps its first characters and counts the ones it cut", () => {
		const [turn] = fold(user("p1", "x".repeat(16_010)));
		expect(turn?.steps[0]).toMatchObject({ kind: "prompt", body: { cut: 10 } });
	});

	test("takeChanged names the turns touched since it was last called, including one whose tool result arrived later", () => {
		const trajectory = new Trajectory();
		for (const entry of [user("p1", "one"), assistant([toolCall("c1", "read", {})], usage(1, 1, 0, 0, 0)), user("p2", "two")]) trajectory.applyEntry(entry);
		expect(trajectory.takeChanged().map(turn => turn.id)).toEqual(["p1", "p2"]);
		trajectory.applyEntry(result("c1", at(), []));
		expect(trajectory.takeChanged().map(turn => turn.id)).toEqual(["p1"]);
		expect(trajectory.takeChanged()).toEqual([]);
	});
});

describe("TrajectoryTail", () => {
	test("publishes every turn on its first read, then only the turns later lines touched", async () => {
		const dir = await mkdtemp(join(tmpdir(), "trajectory-"));
		try {
			const path = join(dir, "session.jsonl");
			const lines = (...entries: unknown[]): string => entries.map(entry => `${JSON.stringify(entry)}\n`).join("");
			await writeFile(path, lines(user("p1", "one"), assistant([toolCall("c1", "read", {})], usage(1, 1, 0, 0, 0))));
			let next = Promise.withResolvers<{ reset: boolean; ids: string[] }>();
			const tail = new TrajectoryTail(path, (reset, turns) => next.resolve({ reset, ids: turns.map(turn => turn.id) }));
			tail.poke();
			expect(await next.promise).toEqual({ reset: true, ids: ["p1"] });
			next = Promise.withResolvers();
			await appendFile(path, lines(result("c1", at(), []), user("p2", "two")));
			tail.poke();
			expect(await next.promise).toEqual({ reset: false, ids: ["p1", "p2"] });
			tail.close();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
