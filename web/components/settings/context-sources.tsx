/** Settings › Analytics' context sources: what fills each request's input, by workspace or session, over the tab's range. */
import { useEffect, useState } from "react";
import type { AnalyticsRange, ContextReport, ContextSourceKind } from "../../../src/shared/analytics";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { folderName } from "../../labels";
import { contextStore } from "../../reads";
import { LoadNote } from "../sheet-details";
import { compact, dollars, full, percent } from "./analytics-format";
import { Count, RowHead } from "./table";

const kindLabel: Record<ContextSourceKind, string> = {
	file: "Instruction file",
	skill: "Skill",
	mcp: "MCP server",
	rule: "Rule",
	prompt: "System prompt",
	injection: "Injected message",
	tool: "Tool results",
	conversation: "Conversation",
	side: "Side request",
	unrecorded: "Not in transcript",
};

/** How many sources show before "Show all". */
const SHOWN = 25;

/** The value the filters use for "every workspace" and "every session": the select keeps strings. */
const ALL = "";

function SourcesTable({ report }: { report: ContextReport }) {
	const [all, setAll] = useState(false);
	const shown = all ? report.sources : report.sources.slice(0, SHOWN);
	return (
		<div className="space-y-2">
			<div className="overflow-x-auto">
				<table className="w-full min-w-[48rem] text-sm">
					<caption className="sr-only">Context sources by input tokens</caption>
					<thead className="text-xs text-muted-foreground">
						<tr>
							<th scope="col" className="pb-2 text-start font-medium">Source</th>
							<th scope="col" className="pb-2 ps-4 text-start font-medium">Kind</th>
							{["Avg tokens/turn", "Turns", "Total tokens", "Est. cost", "Share of input"].map(column => <th key={column} scope="col" className="pb-2 ps-4 text-end font-medium">{column}</th>)}
						</tr>
					</thead>
					<tbody>
						{shown.map(source => <tr key={`${source.kind}:${source.name}`}>
							<RowHead className="max-w-80 truncate" title={source.name}>{source.name}</RowHead>
							<td className="whitespace-nowrap border-t border-border py-2 ps-4 text-muted-foreground">{kindLabel[source.kind]}</td>
							<Count>{compact.format(Math.round(source.tokens / source.turns))}</Count>
							<Count>{full.format(source.turns)}</Count>
							<Count title={`${full.format(Math.round(source.tokens))} tokens`}>{compact.format(source.tokens)}</Count>
							<Count>{dollars(source.cost)}</Count>
							<Count>{percent.format(source.tokens / report.input)}</Count>
						</tr>)}
					</tbody>
				</table>
			</div>
			{report.sources.length > SHOWN && (
				<Button variant="ghost" size="compact" onClick={() => setAll(!all)}>
					{all ? `Show top ${SHOWN}` : `Show all ${full.format(report.sources.length)}`}
				</Button>
			)}
		</div>
	);
}

/**
 * The context sources over `range`, for every workspace, one, or one session, read again while the tab shows:
 * often while the index reads session files, slower after it catches up.
 */
export function ContextSources({ range, active }: { range: AnalyticsRange; active: boolean }) {
	const [cwd, setCwd] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const params = new URLSearchParams({ range });
	if (cwd !== null) params.set("cwd", cwd);
	if (sessionId !== null) params.set("session", sessionId);
	const scope = params.toString();
	const entry = contextStore.use(scope);
	const answer = entry.read?.data ?? null;
	const [last, setLast] = useState<ContextReport | null>(null);
	if (answer !== null && answer !== last) setLast(answer);
	const { error } = entry;
	const report = answer ?? (error === null ? last : null);
	const switching = report !== null && answer === null;
	const indexing = report?.indexing ?? null;
	useEffect(() => {
		if (!active) return;
		void contextStore.refresh(scope);
		const timer = setInterval(() => void contextStore.refresh(scope), indexing ? 2_000 : 30_000);
		return () => clearInterval(timer);
	}, [active, scope, indexing !== null]);
	const workspaces: Record<string, string> = { [ALL]: "All workspaces" };
	for (const workspace of report?.workspaces ?? []) workspaces[workspace.cwd] = folderName(workspace.cwd) ?? workspace.cwd;
	if (cwd !== null) workspaces[cwd] ??= folderName(cwd) ?? cwd;
	const sessions: Record<string, string> = { [ALL]: "All sessions" };
	for (const session of report?.sessions ?? []) sessions[session.sessionId] = session.title ?? session.sessionId;
	if (sessionId !== null) sessions[sessionId] ??= sessionId;
	return (
		<section className="space-y-3" aria-labelledby="analytics-context">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 id="analytics-context" className="text-sm font-semibold">Context sources</h3>
				<div className="flex flex-wrap gap-2">
					<Select<string>
						items={workspaces}
						value={cwd ?? ALL}
						onValueChange={next => {
							setCwd(next ? next : null);
							setSessionId(null);
						}}
					>
						<SelectTrigger aria-label="Workspace" className="max-w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(workspaces).map(([value, label]) => <SelectItem key={value} value={value} title={value || undefined}>{label}</SelectItem>)}
						</SelectContent>
					</Select>
					<Select<string> items={sessions} value={sessionId ?? ALL} onValueChange={next => setSessionId(next ? next : null)}>
						<SelectTrigger aria-label="Session" className="max-w-72">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(sessions).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
						</SelectContent>
					</Select>
				</div>
			</div>
			<p className="text-xs text-muted-foreground">
				What each request sends as input, cached or not. Cost splits each request's input, cache read, and cache write cost by token share.
				The system prompt and tool definitions of a main session are not in its transcript, so they show as "Not in transcript".
			</p>
			{indexing && <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Reading session files… {indexing.total > 0 && `${full.format(indexing.current)} of ${full.format(indexing.total)}`}</p>}
			{error && report && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot refresh context sources: {error}</p>}
			<div aria-busy={switching || undefined} className={cn("space-y-3 transition-opacity duration-150", switching && "opacity-50")}>
				{!report ? <LoadNote loading="Reading context sources…" error={error} /> : report.turns === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">{indexing ? "Session files are still being read." : "No requests in this time range."}</div>
				) : (
					<>
						<p className="text-sm tabular-nums">
							{full.format(report.turns)} requests · {compact.format(report.input)} input tokens · {dollars(report.cost)} input cost
						</p>
						<SourcesTable report={report} />
					</>
				)}
			</div>
		</section>
	);
}
