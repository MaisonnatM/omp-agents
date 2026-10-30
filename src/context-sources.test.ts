import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionSummary } from "./analytics";
import { isObject, str } from "./json";
import { attributeTurns, buildContextReport, type ContextFileRow, type ContextSourceRow, type SessionReading, sourceOfMessage, splitSystemPrompt } from "./context-sources";

describe("splitSystemPrompt", () => {
	const role = [
		"§ Role",
		"You are omp.",
		"§ Runtime",
		"<skills>",
		"- grilling: Use when stress-testing plans.",
		"- writing-tests: Use for pytest.",
		"</skills>",
		"<domain-rules>",
		"- pydantic-config-evolution (yampa/actions/**/*.py): Changing configs.",
		"</domain-rules>",
		"# xd:// Tool Devices",
		"- xd://mcp__google_calendar_create_event — Creates an event.",
		"- xd://mcp__slack_send_message — Sends a message.",
	].join("\n");
	const context = [
		"<project-context>",
		"<file path=\"/repo/AGENTS.md\">",
		"# Guide",
		"Read the standards.",
		"</file>",
		"</project-context>",
		"## MCP Tool Routes",
		"- \"create_event\" → `xd://mcp__google_calendar_create_event` — Creates an event.",
		"## MCP Server Instructions",
		"### datadog",
		"Load a skill first.",
		"### linear",
		"Send real newlines.",
	].join("\n");
	const parts = splitSystemPrompt([role, context]);

	test("names each instruction file, skill, rule, MCP server, and section by what it is", () => {
		expect([...parts.keys()].sort()).toEqual([
			"file:/repo/AGENTS.md",
			"mcp:datadog",
			"mcp:google_calendar",
			"mcp:linear",
			"mcp:slack",
			"prompt:MCP Server Instructions",
			"prompt:MCP Tool Routes",
			"prompt:Project context",
			"prompt:Role",
			"prompt:Runtime",
			"rule:pydantic-config-evolution",
			"skill:grilling",
			"skill:writing-tests",
		]);
		expect(parts.get("file:/repo/AGENTS.md")).toBe("<file path=\"/repo/AGENTS.md\">\n# Guide\nRead the standards.\n</file>");
		expect(parts.get("mcp:google_calendar")!.split("\n")).toHaveLength(2);
		expect(parts.get("mcp:datadog")).toBe("### datadog\nLoad a skill first.");
	});

	test("loses no line of the prompt", () => {
		const lines = [...parts.values()].reduce((sum, text) => sum + text.split("\n").length, 0);
		expect(lines).toBe(role.split("\n").length + context.split("\n").length);
	});
});

describe("sourceOfMessage", () => {
	test("credits an invoked skill, a rule reminder, a tool's result, and an injection to what they are", () => {
		expect(sourceOfMessage({ role: "custom", customType: "skill-prompt", details: { name: "grilling" } })).toBe("skill:grilling");
		expect(sourceOfMessage({ role: "custom", customType: "xdev-mount-notice" })).toBe("injection:xdev-mount-notice");
		expect(sourceOfMessage({ role: "developer", content: [{ type: "text", text: "<system-reminder reason=\"rule_violation\" rule=\"ts-no-any\" path=\"x\">" }] })).toBe("rule:ts-no-any");
		expect(sourceOfMessage({ role: "developer", content: "<system-reminder>todo</system-reminder>" })).toBe("injection:System reminders");
		expect(sourceOfMessage({ role: "toolResult", toolName: "read" })).toBe("tool:read");
		expect(sourceOfMessage({ role: "user", content: "hi" })).toBe("conversation:User prompts");
	});
});

describe("attributeTurns", () => {
	const at = "2026-10-01T12:00:00.000Z";
	const model = { api: "anthropic-messages", provider: "anthropic", model: "claude" };
	const assistant = (id: string, input: number, cacheRead: number, cost: number, timestamp = at) => ({
		type: "message",
		id,
		parentId: "u1",
		timestamp,
		message: { role: "assistant", ...model, content: [], usage: { input, cacheRead, cacheWrite: 0, output: 5, cost: { input: cost, cacheRead: 0, cacheWrite: 0 } } },
	});
	/** Counts a message as the length of its `text`, plain text as its length. */
	const reading = (entries: unknown[], context: unknown[]): SessionReading => ({
		entries,
		context: () => context,
		counter: () => ({ message: message => (isObject(message) ? (str(message.text) ?? "").length : 0), text: text => text.length }),
	});
	const user = { role: "user", text: "x".repeat(100) };
	const read = { role: "toolResult", toolName: "read", text: "y".repeat(300) };

	test("the sources of a request add up to its input, cache reads included, the rest left unrecorded", () => {
		const [turn] = attributeTurns(reading([{ type: "session", id: "s1", timestamp: at }, assistant("a1", 100, 900, 0.5)], [user, read]));
		expect(turn!.input).toBe(1000);
		expect(turn!.cost).toBe(0.5);
		expect(Object.fromEntries(turn!.tokens)).toEqual({ "conversation:User prompts": 100, "tool:read": 300, "unrecorded:System prompt and tool definitions": 600 });
	});

	test("counts above the billed input scale down to it", () => {
		const [turn] = attributeTurns(reading([assistant("a1", 200, 0, 0.1)], [user, read]));
		expect(Object.fromEntries(turn!.tokens)).toEqual({ "conversation:User prompts": 50, "tool:read": 150 });
	});

	test("a subagent's recorded system prompt counts by section, leaving only the tool definitions unrecorded", () => {
		const init = { type: "session_init", id: "i1", systemPrompt: ["§ Role\nabc", "### nothing"] };
		const [turn] = attributeTurns(reading([init, assistant("a1", 1000, 0, 1)], [user]));
		expect(turn!.tokens.get("prompt:Role")).toBe("§ Role\nabc".length);
		expect(turn!.tokens.has("unrecorded:System prompt and tool definitions")).toBe(false);
		expect([...turn!.tokens.values()].reduce((a, b) => a + b)).toBe(1000);
		expect(turn!.tokens.get("unrecorded:Tool definitions")).toBeGreaterThan(0);
	});

	test("a side request is one source, and a fork skips the requests it copied from its parent", () => {
		const fork = { type: "session", id: "s2", timestamp: at, parentSession: "/parent.jsonl" };
		const warm = { type: "model_usage", id: "m1", timestamp: at, purpose: "cache-warm", usage: { input: 10, cacheRead: 40, cost: { input: 0.01 } } };
		const turns = attributeTurns(reading([fork, assistant("old", 100, 0, 1, "2026-10-01T11:00:00.000Z"), warm, assistant("new", 100, 0, 1)], [user]));
		expect(turns.map(turn => turn.entryId)).toEqual(["m1", "new"]);
		expect(Object.fromEntries(turns[0]!.tokens)).toEqual({ "side:cache-warm": 50 });
	});
});

describe("buildContextReport", () => {
	const root = "/sessions";
	const main = (id: string) => join(root, "-code-app", `2026-10-01T00-00-00-000Z_${id}.jsonl`);
	const sub = (id: string) => join(root, "-code-app", `2026-10-01T00-00-00-000Z_${id}`, "Scout.jsonl");
	const files: ContextFileRow[] = [
		{ sessionFile: main("s1"), cwd: "/code/app", turns: 2, input: 1000, cost: 1 },
		{ sessionFile: sub("s1"), cwd: "/code/app-wt", turns: 1, input: 500, cost: 0.5 },
		{ sessionFile: main("s2"), cwd: "/code/other", turns: 1, input: 300, cost: 0.3 },
	];
	const sources: ContextSourceRow[] = [
		{ sessionFile: main("s1"), source: "skill:grilling", turns: 2, tokens: 400, cost: 0.4 },
		{ sessionFile: main("s1"), source: "tool:read", turns: 2, tokens: 600, cost: 0.6 },
		{ sessionFile: sub("s1"), source: "skill:grilling", turns: 1, tokens: 500, cost: 0.5 },
		{ sessionFile: main("s2"), source: "tool:read", turns: 1, tokens: 300, cost: 0.3 },
	];
	const report = (cwd: string | null, sessionId: string | null, factsOf: (id: string) => SessionSummary | null = () => null) =>
		buildContextReport({ range: "7d", cwd, sessionId, indexing: null, files, sources, root, factsOf });

	test("ranks sources by tokens and folds a subagent into its session's workspace", () => {
		const { sources: ranked, input, turns, workspaces } = report("/code/app", null);
		expect(ranked.map(source => [source.kind, source.name, source.tokens])).toEqual([["skill", "grilling", 900], ["tool", "read", 600]]);
		expect(ranked[0]!.turns).toBe(3);
		expect({ input, turns }).toEqual({ input: 1500, turns: 3 });
		expect(workspaces).toEqual([{ cwd: "/code/app", input: 1500 }, { cwd: "/code/other", input: 300 }]);
	});

	test("one session's report counts only its files", () => {
		const { sources: ranked, input } = report(null, "s2");
		expect(input).toBe(300);
		expect(ranked.map(source => source.name)).toEqual(["read"]);
	});

	test("a listed session's workspace wins over its file's directory", () => {
		const facts: SessionSummary = { file: main("s2"), workspace: "/code/listed", title: "Listed" };
		const { input, sessions } = report("/code/listed", null, id => (id === "s2" ? facts : null));
		expect(input).toBe(300);
		expect(sessions).toEqual([{ sessionId: "s2", title: "Listed", input: 300 }]);
	});
});
