/** Settings › Resources' memory over the last day, drawn with `recharts`, a chunk of its own the tab loads on first use. */
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import type { ResourceSample } from "../../../src/shared/resources";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const CONFIG: ChartConfig = {
	used: { label: "In use", color: "var(--chart-1)" },
	swap: { label: "Swap", color: "var(--chart-2)" },
};

const GB = 1024 ** 3;
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const gigabytes = (bytes: number): number => Math.round((bytes / GB) * 10) / 10;

export function ResourcesChart({ samples }: { samples: ResourceSample[] }) {
	const data = samples
		.filter(({ reading }) => reading.pressure !== "unknown")
		.map(({ at, reading }) => ({ at, used: gigabytes(reading.totalBytes - reading.availableBytes), swap: gigabytes(reading.swapUsedBytes) }));
	const jetsam = samples.flatMap(({ jetsam }) => jetsam);
	const total = gigabytes(samples.at(-1)?.reading.totalBytes ?? 0);
	return (
		<ChartContainer config={CONFIG} role="figure" aria-label="Memory in use and swap over the last 24 hours, with each Jetsam event marked" className="aspect-auto h-56 w-full">
			<AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={at => TIME.format(at)} tickLine={false} axisLine={false} tickMargin={10} minTickGap={48} />
				<YAxis tickLine={false} axisLine={false} tickMargin={8} width="auto" unit=" GB" domain={[0, total || "auto"]} />
				<ChartLegend content={<ChartLegendContent />} />
				<ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => TIME.format(payload[0]?.payload.at)} />} />
				<Area dataKey="used" type="monotone" stroke="var(--color-used)" fill="var(--color-used)" fillOpacity={0.25} isAnimationActive={false} />
				<Area dataKey="swap" type="monotone" stroke="var(--color-swap)" fill="var(--color-swap)" fillOpacity={0.25} isAnimationActive={false} />
				{jetsam.map(event => (
					<ReferenceLine key={event.at} x={event.at} stroke="var(--destructive)" strokeDasharray="3 3" label={{ value: "Jetsam", position: "insideTopRight", fontSize: 10 }} />
				))}
			</AreaChart>
		</ChartContainer>
	);
}
