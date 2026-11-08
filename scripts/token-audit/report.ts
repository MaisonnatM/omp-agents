/**
 * Prices omp's recorded requests by billing type, so a harness change reads as "old cost per task vs new".
 * Reads omp-stats' `~/.omp/stats.db` read-only; run it before and after a change over windows of the same length.
 * `--request` sizes one provider request that `scripts/token-audit/dump-request.ts` wrote: system blocks and each tool.
 * Usage: `bun scripts/token-audit/report.ts --days 14 [--since 2026-11-08] [--request tmp/req.json]`.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		db: { type: "string", default: join(homedir(), ".omp", "stats.db") },
		days: { type: "string", default: "14" },
		since: { type: "string" },
		request: { type: "string" },
	},
});
const from = values.since ? Date.parse(values.since) : Date.now() - Number(values.days) * 86_400_000;
const db = new Database(values.db, { readonly: true });
const usd = (n: number) => `$${n.toFixed(1)}`;
const pct = (part: number, whole: number) => `${whole > 0 ? ((100 * part) / whole).toFixed(1) : "0.0"}%`;

function table(title: string, rows: Record<string, unknown>[]): void {
	console.log(`\n## ${title}`);
	if (rows.length === 0) return console.log("(none)");
	const keys = Object.keys(rows[0]!);
	const cell = (v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v ?? ""));
	const widths = keys.map(k => Math.max(k.length, ...rows.map(r => cell(r[k]).length)));
	console.log(keys.map((k, i) => k.padEnd(widths[i]!)).join("  "));
	for (const r of rows) console.log(keys.map((k, i) => cell(r[k]).padEnd(widths[i]!)).join("  "));
}

interface Billing {
	agent: string;
	sessions: number;
	requests: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	total: number;
	readTokens: number;
	inputTokens: number;
}
const billing = db
	.query<Billing, [number]>(
		`SELECT agent_type AS agent, COUNT(DISTINCT session_file) AS sessions, COUNT(*) AS requests,
			TOTAL(cost_input) AS input, TOTAL(cost_cache_read) AS cacheRead, TOTAL(cost_cache_write) AS cacheWrite,
			TOTAL(cost_output) AS output, TOTAL(cost_total) AS total, TOTAL(cache_read_tokens) AS readTokens,
			TOTAL(input_tokens + cache_read_tokens + cache_write_tokens) AS inputTokens
		FROM messages WHERE timestamp >= ? GROUP BY agent_type ORDER BY total DESC`,
	)
	.all(from);
const spend = billing.reduce((sum, row) => sum + row.total, 0);
console.log(`# Token cost since ${new Date(from).toISOString().slice(0, 16)}: ${usd(spend)} list price`);
table(
	"Cost by agent and billing type",
	billing.map(r => ({
		agent: r.agent,
		share: pct(r.total, spend),
		total: usd(r.total),
		output: usd(r.output),
		cacheWrite: usd(r.cacheWrite),
		cacheRead: usd(r.cacheRead),
		uncached: usd(r.input),
		sessions: r.sessions,
		"req/session": Math.round(r.requests / r.sessions),
		"$/session": usd(r.total / r.sessions),
		"avg context": `${Math.round(r.inputTokens / r.requests / 1000)}k`,
		"cache hit": pct(r.readTokens, r.inputTokens),
	})),
);

/** Each request's cache write, labelled by why its prefix was not read: a first request, a compaction, a model switch, the idle gap, or a write larger than the context grew (the prefix changed). */
const writes = db
	.query<{ agent: string; cause: string; requests: number; tokens: number; cost: number }, [number]>(
		`WITH w AS (
			SELECT agent_type, model, timestamp, cache_write_tokens, cost_cache_write,
				input_tokens + cache_read_tokens + cache_write_tokens AS ctx,
				LAG(timestamp) OVER s AS prev, LAG(model) OVER s AS prev_model,
				LAG(input_tokens + cache_read_tokens + cache_write_tokens) OVER s AS prev_ctx
			FROM messages WHERE timestamp >= ? AND cache_write_tokens > 0
			WINDOW s AS (PARTITION BY session_file ORDER BY timestamp))
		SELECT agent_type AS agent, CASE
				WHEN prev IS NULL THEN 'first request'
				WHEN prev_model <> model THEN 'model switch'
				WHEN ctx < prev_ctx * 0.6 THEN 'compaction'
				WHEN timestamp - prev >= 3600000 THEN 'idle over 1h'
				WHEN timestamp - prev >= 300000 THEN 'idle 5m-1h'
				WHEN cache_write_tokens - MAX(0, ctx - prev_ctx) > 2000 THEN 'prefix changed'
				ELSE 'new turn content' END AS cause,
			COUNT(*) AS requests, TOTAL(cache_write_tokens) AS tokens, TOTAL(cost_cache_write) AS cost
		FROM w GROUP BY 1, 2 ORDER BY 1, cost DESC`,
	)
	.all(from);
table(
	"Cache writes by cause",
	writes.map(r => ({ agent: r.agent, cause: r.cause, requests: r.requests, "avg tokens": Math.round(r.tokens / r.requests), cost: usd(r.cost), share: pct(r.cost, spend) })),
);

/** The agent a subagent's file names in its `session_init` entry, e.g. `scout` or `task`. */
function agentOf(file: string): string {
	try {
		for (const line of readFileSync(file, "utf8").split("\n", 40)) {
			if (!line.includes('"session_init"')) continue;
			const entry: unknown = JSON.parse(line);
			return entry && typeof entry === "object" && "agent" in entry && typeof entry.agent === "string" ? entry.agent : "unnamed";
		}
		return "unnamed";
	} catch {
		return "file deleted";
	}
}
const perFile = db
	.query<{ file: string; requests: number; total: number }, [number]>(
		`SELECT session_file AS file, COUNT(*) AS requests, TOTAL(cost_total) AS total
		FROM messages WHERE timestamp >= ? AND agent_type = 'subagent' GROUP BY session_file`,
	)
	.all(from);
const byAgent = new Map<string, { runs: number; requests: number; total: number }>();
for (const { file, requests, total } of perFile) {
	const agent = agentOf(file);
	const row = byAgent.get(agent) ?? { runs: 0, requests: 0, total: 0 };
	row.runs += 1;
	row.requests += requests;
	row.total += total;
	byAgent.set(agent, row);
}
table(
	"Subagent cost by agent",
	[...byAgent]
		.sort((a, b) => b[1].total - a[1].total)
		.map(([agent, r]) => ({ agent, runs: r.runs, "req/run": Math.round(r.requests / r.runs), cost: usd(r.total), share: pct(r.total, spend), "$/run": usd(r.total / r.runs) })),
);

const tools = db
	.query<{ agent: string; tool: string; calls: number; sessions: number; errors: number; chars: number }, [number]>(
		`SELECT agent_type AS agent, tool_name AS tool, COUNT(*) AS calls, COUNT(DISTINCT session_file) AS sessions,
			TOTAL(is_error) AS errors, AVG(result_chars) AS chars
		FROM tool_calls WHERE timestamp >= ? GROUP BY 1, 2 ORDER BY 1, sessions DESC`,
	)
	.all(from);
const sessionsOf = new Map(billing.map(r => [r.agent, r.sessions]));
table(
	"Tools: share of sessions that call each, and errors",
	tools
		.filter(r => r.calls >= 5)
		.map(r => ({ agent: r.agent, tool: r.tool, "sessions using": pct(r.sessions, sessionsOf.get(r.agent) ?? 0), calls: r.calls, errors: pct(r.errors, r.calls), "avg result chars": Math.round(r.chars ?? 0) })),
);

if (values.request) {
	interface Payload {
		system?: { text: string; cache_control?: { ttl?: string } }[];
		tools?: { name: string }[];
		messages?: unknown[];
	}
	const payload = JSON.parse(readFileSync(values.request, "utf8")) as Payload;
	const approx = (chars: number) => Math.round(chars / 3.6);
	const system = (payload.system ?? []).map((block, index) => ({
		part: `system block ${index}`,
		chars: block.text.length,
		"~tokens": approx(block.text.length),
		cache: block.cache_control ? (block.cache_control.ttl ?? "5m") : "",
	}));
	const toolRows = (payload.tools ?? []).map(tool => ({ part: `tool ${tool.name}`, chars: JSON.stringify(tool).length, "~tokens": approx(JSON.stringify(tool).length), cache: "" }));
	toolRows.sort((a, b) => b.chars - a.chars);
	const toolChars = toolRows.reduce((sum, row) => sum + row.chars, 0);
	table(`Request ${values.request}: ${toolRows.length} tools, ${toolChars} chars of tool schemas (~tokens at 3.6 chars each)`, [...system, ...toolRows]);
}
