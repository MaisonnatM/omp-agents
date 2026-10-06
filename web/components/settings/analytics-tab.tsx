/** The settings tab for omp's request usage by time, model, project, agent, tool, and session. */
import { type ReactNode, useEffect, useState } from "react";
import { ANALYTICS_RANGES, type Analytics, type AnalyticsRange, type AnalyticsSession } from "../../../src/shared/analytics";
import { hashForSession } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { modelLabel, modelOrg, projectName, providerLabel, readTime } from "../../labels";
import { useRead } from "../../reads";
import { OrgIcon } from "../org-icon";
import { LoadNote } from "../sheet-details";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const dollars = (value: number): string =>
	new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(value);
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

function Trend({ series, range }: { series: Analytics["series"]; range: AnalyticsRange }) {
	const max = Math.max(1, ...series.map(point => point.tokens));
	const width = 1000 / Math.max(1, series.length);
	// omp-stats' daily buckets start at UTC midnight, so a local date could name the day before.
	const tick = (start: number): string => new Date(start).toLocaleString(undefined, range === "24h" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", timeZone: "UTC" });
	return (
		<section className="space-y-3" aria-labelledby="analytics-trend">
			<div className="flex items-baseline justify-between gap-4">
				<h3 id="analytics-trend" className="text-sm font-semibold">Token usage over time</h3>
				<span className="text-xs text-muted-foreground">{range === "24h" ? "Hourly" : "Daily"}</span>
			</div>
			<div className="rounded-md border border-border px-3 pb-2 pt-4">
				<svg viewBox="0 0 1000 160" preserveAspectRatio="none" className="h-40 w-full text-primary" role="img" aria-label="Token usage by time bucket">
					<line x1="0" y1="159" x2="1000" y2="159" className="stroke-border" />
					{series.map(({ start, tokens, cost, requests }, index) => {
						const height = (tokens / max) * 148;
						return (
							<rect key={start} x={index * width + 1} y={159 - height} width={Math.max(1, width - 2)} height={Math.max(1, height)} fill="currentColor" className="opacity-75 hover:opacity-100">
								<title>{`${tick(start)}: ${full.format(tokens)} tokens, ${dollars(cost)}, ${full.format(requests)} requests`}</title>
							</rect>
						);
					})}
				</svg>
				<div className="flex justify-between text-xs text-muted-foreground tabular-nums">
					<span>{series[0] ? tick(series[0].start) : ""}</span>
					<span>{series.length > 1 ? tick(series[series.length - 1]!.start) : ""}</span>
				</div>
			</div>
			<ol className="sr-only">
				{series.map(({ start, tokens, cost, requests }) => <li key={start}>{tick(start)}: {full.format(tokens)} tokens, {dollars(cost)}, {full.format(requests)} requests.</li>)}
			</ol>
		</section>
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
	const name = title ?? (listed ? (projectName(cwd) ?? "Untitled session") : "Deleted session");
	return (
		<tr>
			<th scope="row" className="max-w-48 border-t border-border py-2 text-start font-medium">
				{listed ? (
					<a href={hashForSession(sessionId)} className="block truncate rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={name}>{name}</a>
				) : (
					<span className="block truncate font-normal text-muted-foreground" title={`${sessionId}: its transcript is no longer on disk`}>{name}</span>
				)}
			</th>
			<td className="max-w-32 truncate border-t border-border py-2 ps-4 text-muted-foreground" title={cwd}>{projectName(cwd) ?? cwd}</td>
			<Count title={`${full.format(usage.tokens.total)} tokens`}>{compact.format(usage.tokens.total)}</Count>
			<Count title={`${full.format(subagentTokens)} subagent tokens`}>{percent.format(usage.tokens.total ? subagentTokens / usage.tokens.total : 0)}</Count>
			<Count>{dollars(usage.cost)}</Count>
			<td className="max-w-40 truncate border-t border-border py-2 ps-4 text-end text-xs text-muted-foreground" title={models.join(", ")}>{sessionModels(models)}</td>
			<Count title={new Date(lastAt).toLocaleString()}>{readTime(lastAt)}</Count>
		</tr>
	);
}

function UsageBody({ data }: { data: Analytics }) {
	const { totals, series, models, projects, agents, tools, sessions, range } = data;
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
			<Trend series={series} range={range} />
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
				<section className="space-y-3" aria-labelledby="analytics-projects">
					<h3 id="analytics-projects" className="text-sm font-semibold">Projects</h3>
					<Table label="Projects by token usage" columns={["Project", "Tokens", "Requests", "Cost"]}>
						{projects.map(project => <tr key={project.cwd}>
							<th scope="row" className="max-w-64 truncate border-t border-border py-2 text-start font-medium" title={project.cwd}>{projectName(project.cwd) ?? project.cwd}</th>
							<Count title={`${full.format(project.tokens.total)} tokens`}>{compact.format(project.tokens.total)}</Count>
							<Count>{full.format(project.requests)}</Count>
							<Count>{dollars(project.cost)}</Count>
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
				<Table label="Top 20 sessions by token usage" columns={["Session", "Project", "Tokens", "Subagents", "Cost", "Models", "Last active"]} textColumns={2} wide>
					{sessions.map(session => <SessionRow key={session.sessionId} session={session} />)}
				</Table>
			</section>
		</div>
	);
}

/** Analytics over the chosen range, refreshed while the tab shows: often while omp-stats indexes, slower after it finishes. */
export function AnalyticsTab({ active }: { active: boolean }) {
	const [range, setRange] = useState<AnalyticsRange>("7d");
	const [version, setVersion] = useState(0);
	const { data, error } = useRead<Analytics>(`/api/analytics?range=${range}`, version);
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setVersion(value => value + 1), data?.sync.phase === "syncing" ? 2_000 : 30_000);
		return () => clearInterval(timer);
	}, [active, data?.sync.phase]);
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
			{!data ? <LoadNote loading="Reading omp's usage…" error={error} /> : data.totals.requests === 0 ? (
				<div className="py-12 text-center text-sm text-muted-foreground">{data.sync.phase === "syncing" ? "Your session history is still being indexed." : "No requests in this time range."}</div>
			) : <UsageBody data={data} />}
		</div>
	);
}
