/** Provider token usage, with exact bucket data available without the chart. */
import { useId, useMemo, useState } from "react";
import { Bar, BarChart, BarStack, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { Analytics, AnalyticsProviderUsage, AnalyticsRange } from "../../../src/shared/analytics";
import { providerLabel } from "../../labels";
import { compact, dollars, full } from "./analytics-format";

const providerHues: Record<string, number> = {
	anthropic: 45,
	openai: 155,
	"openai-codex": 255,
	google: 300,
	"google-gemini-cli": 330,
	"github-copilot": 85,
	openrouter: 205,
	xai: 15,
};

function providerColor(provider: string): string {
	let hash = 0;
	for (const character of provider) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
	const hue = Object.hasOwn(providerHues, provider) ? providerHues[provider] : hash % 360;
	return `oklch(0.6 0.1 ${hue})`;
}

type ChartBucket = Omit<Analytics["series"][number], "providers"> & { providers: Map<string, AnalyticsProviderUsage> };
type ChartProvider = { provider: string; label: string; color: string; tokens: (bucket: ChartBucket) => number };

function BucketTooltip({ bucket, providers, date }: { bucket: ChartBucket; providers: ChartProvider[]; date: string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			aria-atomic="true"
			// The tooltip takes pointer events so a long list scrolls; keep those events from moving or toggling the chart's active bucket.
			onMouseMove={event => event.stopPropagation()}
			onTouchMove={event => event.stopPropagation()}
			onClick={event => event.stopPropagation()}
			className="max-h-[min(20rem,50dvh)] w-80 max-w-full overflow-auto rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-surface-3"
		>
			<p className="mb-3 font-medium">{date}</p>
			<dl className="space-y-3 tabular-nums">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border pb-3">
					<dt className="font-semibold">Total</dt>
					<dd className="text-end">
						<p className="font-semibold">{full.format(bucket.tokens)} tokens</p>
						<p className="mt-1 text-muted-foreground">{dollars(bucket.cost)} · {full.format(bucket.requests)} requests</p>
					</dd>
				</div>
				{providers.map(({ provider, label, color }) => {
					const usage = bucket.providers.get(provider);
					return (
						<div key={provider} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
							<dt className="flex items-center gap-1.5">
								<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
								<span className="wrap-anywhere">{label}</span>
							</dt>
							<dd className="text-end">
								<p>{full.format(usage?.tokens ?? 0)} tokens</p>
								<p className="mt-1 text-muted-foreground">{dollars(usage?.cost ?? 0)} · {full.format(usage?.requests ?? 0)} requests</p>
							</dd>
						</div>
					);
				})}
			</dl>
		</div>
	);
}

/** The daily dates name UTC buckets; hourly dates name the local hour, including its date and zone. */
export function ProviderTrend({ series, providers, range }: { series: Analytics["series"]; providers: Analytics["providers"]; range: AnalyticsRange }) {
	const id = useId();
	const [trigger, setTrigger] = useState<"hover" | "click">("hover");
	const [showData, setShowData] = useState(false);
	const chartProviders = useMemo<ChartProvider[]>(() => providers.map(({ provider }) => ({
		provider,
		label: providerLabel(provider),
		color: providerColor(provider),
		tokens: (bucket: ChartBucket) => bucket.providers.get(provider)?.tokens ?? 0,
	})), [providers]);
	const buckets = useMemo<ChartBucket[]>(() => series.map(bucket => ({
		...bucket,
		providers: new Map(bucket.providers.map(usage => [usage.provider, usage])),
	})), [series]);
	const byStart = useMemo(() => new Map(buckets.map(bucket => [bucket.start, bucket])), [buckets]);
	const dates = useMemo(() => ({
		tick: new Intl.DateTimeFormat(undefined, range === "24h"
			? { month: "short", day: "numeric", hour: "numeric" }
			: { month: "short", day: "numeric", timeZone: "UTC" }),
		detail: new Intl.DateTimeFormat(undefined, range === "24h"
			? { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
			: { year: "numeric", month: "short", day: "numeric", timeZone: "UTC", timeZoneName: "short" }),
	}), [range]);
	const hasTokens = series.some(bucket => bucket.tokens > 0);
	return (
		<section className="space-y-3" aria-labelledby={`${id}-title`}>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 id={`${id}-title`} className="text-sm font-semibold">Token usage over time</h3>
				<span className="text-xs text-muted-foreground">{range === "24h" ? "Hourly · local time" : "Daily · UTC"}</span>
			</div>
			<div className="min-w-0 rounded-md border border-border p-3">
				<ul aria-label="Providers" className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
					{chartProviders.map(({ provider, label, color }) => (
						<li key={provider} className="inline-flex min-w-0 items-center gap-2">
							<span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
							<span className="wrap-anywhere">{label}</span>
						</li>
					))}
				</ul>
				{buckets.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No usage buckets in this time range.</p> : (
					<div
						// Touch has no hover, so taps toggle details; mouse and keyboard keep hover-driven details.
						onPointerDownCapture={event => setTrigger(event.pointerType === "touch" ? "click" : "hover")}
						onPointerMoveCapture={event => { if (event.pointerType === "mouse") setTrigger("hover"); }}
						onKeyDownCapture={() => setTrigger("hover")}
						className="[&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-focus-ring"
					>
						<BarChart
							responsive
							style={{ width: "100%", height: "18rem" }}
							data={buckets}
							accessibilityLayer
							aria-label="Token usage by provider and time bucket"
							aria-describedby={`${id}-help`}
							margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							barCategoryGap="24%"
						>
							<CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
							<XAxis dataKey="start" tickFormatter={start => dates.tick.format(start)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} tickMargin={10} height={40} />
							<YAxis tickFormatter={value => compact.format(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={48} domain={hasTokens ? [0, "auto"] : [0, 1]} allowDecimals={false} />
							<Tooltip
								shared
								filterNull={false}
								trigger={trigger}
								isAnimationActive={false}
								allowEscapeViewBox={{ x: false, y: false }}
								position={{ x: 0 }}
								cursor={{ fill: "var(--hover)", stroke: "var(--border)", strokeWidth: 1, pointerEvents: "none" }}
								wrapperStyle={{ maxWidth: "100%", pointerEvents: "auto", zIndex: 10 }}
								content={({ active, label }) => {
									const bucket = typeof label === "number" ? byStart.get(label) : undefined;
									return active && bucket ? <BucketTooltip bucket={bucket} providers={chartProviders} date={dates.detail.format(bucket.start)} /> : null;
								}}
							/>
							<BarStack stackId="providers" radius={[3, 3, 0, 0]}>
								{chartProviders.map(({ provider, label, color, tokens }) => <Bar<ChartBucket, number> key={provider} dataKey={tokens} name={label} fill={color} maxBarSize={48} isAnimationActive={false} activeBar={false} />)}
							</BarStack>
						</BarChart>
					</div>
				)}
				{buckets.length > 0 && !hasTokens && <p className="mt-2 text-xs text-muted-foreground">No tokens recorded. Select a bucket to inspect costs and requests.</p>}
				<p id={`${id}-help`} className="mt-3 text-xs text-muted-foreground">Hover or tap a bucket for details. Focus the chart and use Left or Right to move between buckets. Escape dismisses details.</p>
			</div>
			<details onToggle={event => setShowData(event.currentTarget.open)}>
				<summary className="w-fit cursor-pointer rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">View bucket data</summary>
				{showData && <div className="mt-3 overflow-x-auto">
					<table className="w-full text-xs tabular-nums">
						<caption className="sr-only">Exact bucket totals and provider breakdown. Missing providers have zero tokens, cost, and requests.</caption>
						<thead className="text-muted-foreground">
							<tr>{["Bucket", "Provider", "Tokens", "Cost", "Requests"].map((label, index) => <th key={label} scope="col" className={`pb-2 font-medium ${index < 2 ? "text-start" : "text-end"} ${index > 0 ? "ps-4" : ""}`}>{label}</th>)}</tr>
						</thead>
						{buckets.map(bucket => <tbody key={bucket.start} className="[&_td]:whitespace-nowrap [&_td]:py-2 [&_td:nth-child(n+3)]:ps-4 [&_td:nth-child(n+3)]:text-end">
							<tr className="border-t border-border font-medium">
								<td className="text-start">{dates.detail.format(bucket.start)}</td>
								<th scope="row" className="py-2 ps-4 text-start"><span className="sr-only">{dates.detail.format(bucket.start)} </span>Total</th>
								<td>{full.format(bucket.tokens)}</td><td>{dollars(bucket.cost)}</td><td>{full.format(bucket.requests)}</td>
							</tr>
							{chartProviders.map(({ provider, label }) => {
								const usage = bucket.providers.get(provider);
								return <tr key={provider}>
									<td className="text-start"><span className="sr-only">{dates.detail.format(bucket.start)}</span></td>
									<th scope="row" className="py-2 ps-4 text-start font-normal"><span className="sr-only">{dates.detail.format(bucket.start)} </span>{label}</th>
									<td>{full.format(usage?.tokens ?? 0)}</td><td>{dollars(usage?.cost ?? 0)}</td><td>{full.format(usage?.requests ?? 0)}</td>
								</tr>;
							})}
						</tbody>)}
					</table>
				</div>}
			</details>
		</section>
	);
}
