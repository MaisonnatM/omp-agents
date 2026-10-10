/** The settings tab for omp's request usage by time, model, workspace, agent, tool, and session. */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ANALYTICS_RANGES, type Analytics, type AnalyticsRange, type AnalyticsSession } from "../../../src/shared/analytics";
import { hashForSession } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { folderName, modelLabel, modelOrg, providerLabel, readTime } from "../../labels";
import { analyticsStore } from "../../reads";
import { OrgIcon } from "../org-icon";
import { LoadNote } from "../sheet-details";
import { compact, dollars, full } from "./analytics-format";
import { ProviderTrend } from "./provider-trend";

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const rangeLabel: Record<AnalyticsRange, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };

/** How many of a session's models its row names before `+N`. */
const SESSION_MODELS = 3;

/** A session's models by name, heaviest first: providers serving the same model read once. */
function sessionModels(selectors: string[]): string {
	const labels = [...new Set(selectors.map(selector => modelLabel(selector)))];
	const shown = labels.slice(0, SESSION_MODELS).join(", ");
	return labels.length > SESSION_MODELS ? `${shown} +${labels.length - SESSION_MODELS}` : shown;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className="min-w-0 rounded-md border border-border px-4 py-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums" title={value}>{value}</p>
			{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

/** `wide` keeps a many-column table legible by scrolling it sideways on narrow screens; the first `textColumns` align to the start. */
function Table({ label, columns, textColumns = 1, wide = false, children }: { label: string; columns: string[]; textColumns?: number; wide?: boolean; children: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<table className={`w-full text-sm ${wide ? "min-w-[40rem]" : ""}`}>
				<caption className="sr-only">{label}</caption>
				<thead className="text-xs text-muted-foreground">
					<tr>{columns.map((column, index) => <th key={column} scope="col" className={`pb-2 font-medium ${index === 0 ? "text-start" : index < textColumns ? "ps-4 text-start" : "ps-4 text-end"}`}>{column}</th>)}</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	);
}

function Count({ children, title }: { children: ReactNode; title?: string }) {
	return <td className="whitespace-nowrap border-t border-border py-2 ps-4 text-end tabular-nums" title={title}>{children}</td>;
}

function AgentSplit({ agents }: { agents: Analytics["agents"] }) {
	const entries = [
		{ key: "main", label: "Main agent", color: "bg-primary" },
		{ key: "subagent", label: "Subagents", color: "bg-sky-500" },
		{ key: "advisor", label: "Advisor", color: "bg-amber-500" },
	] as const;
	const total = entries.reduce((sum, { key }) => sum + agents[key], 0);
	return (
		<section className="space-y-3" aria-labelledby="analytics-agents">
			<h3 id="analytics-agents" className="text-sm font-semibold">Agent types</h3>
			<div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={entries.map(({ key, label }) => `${label}: ${percent.format(total ? agents[key] / total : 0)}`).join(", ")}>
				{entries.map(({ key, color }) => <span key={key} className={color} style={{ width: `${total ? (agents[key] / total) * 100 : 0}%` }} />)}
			</div>
			<ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
				{entries.map(({ key, label, color }) => (
					<li key={key} className="flex items-center gap-2"><span className={`size-2 rounded-full ${color}`} aria-hidden="true" />{label} <span className="tabular-nums text-muted-foreground" title={`${full.format(agents[key])} tokens`}>{compact.format(agents[key])} · {percent.format(total ? agents[key] / total : 0)}</span></li>
				))}
			</ul>
		</section>
	);
}

function SessionRow({ session }: { session: AnalyticsSession }) {
	const { sessionId, title, listed, cwd, usage, subagentTokens, models, lastAt } = session;
	const name = title ?? (listed ? (folderName(cwd) ?? "Untitled session") : "Deleted session");
	return (
		<tr>
			<th scope="row" className="max-w-48 border-t border-border py-2 text-start font-medium">
				{listed ? (
					<a href={hashForSession(sessionId)} className="block truncate rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={name}>{name}</a>
				) : (
					<span className="block truncate font-normal text-muted-foreground" title={`${sessionId}: its transcript is no longer on disk`}>{name}</span>
				)}
			</th>
			<td className="max-w-32 truncate border-t border-border py-2 ps-4 text-muted-foreground" title={cwd}>{folderName(cwd) ?? cwd}</td>
			<Count title={`${full.format(usage.tokens.total)} tokens`}>{compact.format(usage.tokens.total)}</Count>
			<Count title={`${full.format(subagentTokens)} subagent tokens`}>{percent.format(usage.tokens.total ? subagentTokens / usage.tokens.total : 0)}</Count>
			<Count>{dollars(usage.cost)}</Count>
			<td className="max-w-40 truncate border-t border-border py-2 ps-4 text-end text-xs text-muted-foreground" title={models.join(", ")}>{sessionModels(models)}</td>
			<Count title={new Date(lastAt).toLocaleString()}>{readTime(lastAt)}</Count>
		</tr>
	);
}

function UsageBody({ data }: { data: Analytics }) {
	const { totals, series, providers, models, workspaces, agents, tools, sessions, range } = data;
	const labels = models.map(({ selector }) => modelLabel(selector));
	/** Model names more than one provider serves, which the models table tells apart by provider. */
	const sharedLabels = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));
	return (
		<div className="space-y-9">
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Stat label="Tokens" value={compact.format(totals.tokens.total)} hint={`${full.format(totals.tokens.input)} input · ${full.format(totals.tokens.output)} output`} />
				<Stat label="Estimated cost" value={dollars(totals.cost)} hint="API list price, not your subscription bill" />
				<Stat label="Requests" value={full.format(totals.requests)} hint={`${full.format(totals.failed)} failed`} />
				<Stat label="Cache hit rate" value={percent.format(totals.cacheRate)} hint={`${compact.format(totals.tokens.cacheRead)} read · ${compact.format(totals.tokens.cacheWrite)} written`} />
			</div>
			<ProviderTrend series={series} providers={providers} range={range} />
			<div className="grid gap-9 xl:grid-cols-2">
				<section className="space-y-3" aria-labelledby="analytics-models">
					<h3 id="analytics-models" className="text-sm font-semibold">Models</h3>
					<Table label="Models by token usage" columns={["Model", "Tokens", "Requests", "Cost", "Tokens/s"]}>
						{models.map(model => <tr key={model.selector}>
							<th scope="row" className="border-t border-border py-2 text-start font-medium" title={model.selector}>
								<span className="inline-flex items-center gap-2">
									<OrgIcon org={modelOrg(model.selector)} className="size-4 shrink-0" />
									{modelLabel(model.selector)}
									{sharedLabels.has(modelLabel(model.selector)) && <span className="text-xs font-normal text-muted-foreground">{providerLabel(model.selector.slice(0, model.selector.indexOf("/")))}</span>}
								</span>
							</th>
							<Count title={`${full.format(model.tokens.total)} tokens`}>{compact.format(model.tokens.total)}</Count>
							<Count>{full.format(model.requests)}</Count>
							<Count>{dollars(model.cost)}</Count>
							<Count>{model.tokensPerSecond === null ? "–" : compact.format(model.tokensPerSecond)}</Count>
						</tr>)}
					</Table>
				</section>
				<section className="space-y-3" aria-labelledby="analytics-workspaces">
					<h3 id="analytics-workspaces" className="text-sm font-semibold">Workspaces</h3>
					<Table label="Workspaces by token usage" columns={["Workspace", "Tokens", "Requests", "Cost"]}>
						{workspaces.map(workspace => <tr key={workspace.cwd}>
							<th scope="row" className="max-w-64 truncate border-t border-border py-2 text-start font-medium" title={workspace.cwd}>{folderName(workspace.cwd) ?? workspace.cwd}</th>
							<Count title={`${full.format(workspace.tokens.total)} tokens`}>{compact.format(workspace.tokens.total)}</Count>
							<Count>{full.format(workspace.requests)}</Count>
							<Count>{dollars(workspace.cost)}</Count>
						</tr>)}
					</Table>
				</section>
			</div>
			<AgentSplit agents={agents} />
			<section className="space-y-3" aria-labelledby="analytics-tools">
				<h3 id="analytics-tools" className="text-sm font-semibold">Tools</h3>
				<Table label="Tool usage" columns={["Tool", "Calls", "Errors", "Attributed tokens"]}>
					{tools.map(tool => <tr key={tool.name}>
						<th scope="row" className="border-t border-border py-2 text-start font-medium">{tool.name}</th>
						<Count>{full.format(tool.calls)}</Count>
						<Count>{full.format(tool.errors)}</Count>
						<Count title={`${full.format(Math.round(tool.tokenShare))} attributed tokens`}>{compact.format(tool.tokenShare)}</Count>
					</tr>)}
				</Table>
			</section>
			<section className="space-y-3" aria-labelledby="analytics-sessions">
				<h3 id="analytics-sessions" className="text-sm font-semibold">Top sessions</h3>
				<Table label="Top 20 sessions by token usage" columns={["Session", "Workspace", "Tokens", "Subagents", "Cost", "Models", "Last active"]} textColumns={2} wide>
					{sessions.map(session => <SessionRow key={session.sessionId} session={session} />)}
				</Table>
			</section>
		</div>
	);
}

/** Analytics over the chosen range, refreshed while the tab shows: often while omp-stats indexes, slower after it finishes. */
export function AnalyticsTab({ active }: { active: boolean }) {
	const [range, setRange] = useState<AnalyticsRange>("24h");
	const entry = analyticsStore.use(range);
	const answer = entry.read?.data ?? null;
	const [last, setLast] = useState<Analytics | null>(null);
	if (answer !== null && answer !== last) setLast(answer);
	const { error } = entry;
	const data = answer ?? (error === null ? last : null);
	const switching = data !== null && data.range !== range;
	useEffect(() => {
		if (active) void analyticsStore.refresh(range);
	}, [active, range]);
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => void analyticsStore.refresh(range), data?.sync.phase === "syncing" ? 2_000 : 30_000);
		return () => clearInterval(timer);
	}, [active, range, data?.sync.phase]);
	return (
		<div className="space-y-7">
			<div role="group" aria-label="Time range" className="flex flex-wrap gap-1">
				{ANALYTICS_RANGES.map(option => (
					<Button key={option} variant="ghost" size="compact" active={option === range} aria-pressed={option === range} onClick={() => setRange(option)}>
						{rangeLabel[option]}
					</Button>
				))}
			</div>
			{data?.sync.phase === "syncing" && <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Indexing sessions… {data.sync.total > 0 && `${full.format(data.sync.current)} of ${full.format(data.sync.total)}`}</p>}
			{data?.sync.phase === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Indexing failed. omp will retry: {data.sync.error ?? "Unknown error"}</p>}
			{error && data && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot refresh analytics: {error}</p>}
			<div aria-busy={switching || undefined} className={cn("transition-opacity duration-150", switching && "opacity-50")}>
				{!data ? <LoadNote loading="Reading omp's usage…" error={error} /> : data.totals.requests === 0 ? (
					<div className="py-12 text-center text-sm text-muted-foreground">{data.sync.phase === "syncing" ? "Your session history is still being indexed." : "No requests in this time range."}</div>
				) : <UsageBody data={data} />}
			</div>
		</div>
	);
}
