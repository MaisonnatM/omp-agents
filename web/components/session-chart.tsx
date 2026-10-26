/** `ChartView`: a session's `chart` fence drawn with `recharts`, a chunk of its own that `SessionVisual` loads on first use. */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "../../src/shared/session-visuals";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/** How each cartesian chart draws one series, as shadcn's chart examples do. */
const CARTESIAN = {
	bar: { Chart: BarChart, mark: (key: string, color: string) => <Bar key={key} dataKey={key} fill={color} radius={4} /> },
	line: { Chart: LineChart, mark: (key: string, color: string) => <Line key={key} dataKey={key} type="natural" stroke={color} strokeWidth={2} dot={false} /> },
	area: { Chart: AreaChart, mark: (key: string, color: string) => <Area key={key} dataKey={key} type="natural" stroke={color} fill={color} fillOpacity={0.4} /> },
};

const chartColor = (index: number): string => `var(--chart-${(index % 5) + 1})`;

export function ChartView({ spec, label, expanded }: { spec: ChartSpec; label: string; expanded: boolean }) {
	if (spec.type === "pie") {
		const [series] = spec.series;
		// Keyed by slice name, which the spec does not limit, so no name reads an inherited property.
		const config: ChartConfig = Object.create(null);
		config[series.key] = { label: series.label };
		// A slice's name as text, since the tooltip and legend look a name up in `config` only when it is a string.
		const data = spec.data.map(row => ({ ...row, [spec.x]: String(row[spec.x]) }));
		for (const row of data) config[row[spec.x] as string] = { label: row[spec.x] };
		return (
			<ChartContainer config={config} role="figure" aria-label={label} className={cn("mx-auto", expanded ? "h-full max-h-[36rem] w-full" : "aspect-square max-h-[250px]")}>
				<PieChart>
					<ChartTooltip content={<ChartTooltipContent nameKey={spec.x} hideLabel />} />
					<Pie data={data} dataKey={series.key} nameKey={spec.x}>
						{data.map((_, index) => (
							<Cell key={index} fill={chartColor(index)} />
						))}
					</Pie>
					<ChartLegend content={<ChartLegendContent nameKey={spec.x} className="flex-wrap gap-2 *:basis-1/4 *:justify-center" />} />
				</PieChart>
			</ChartContainer>
		);
	}
	const { Chart, mark } = CARTESIAN[spec.type];
	const config: ChartConfig = Object.fromEntries(spec.series.map((series, index) => [series.key, { label: series.label, color: chartColor(index) }]));
	return (
		<ChartContainer config={config} role="figure" aria-label={label} className={cn("aspect-auto w-full", expanded ? "h-full max-h-[36rem]" : "h-64")}>
			<Chart accessibilityLayer data={spec.data} margin={{ left: 4, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey={spec.x} tickLine={false} axisLine={false} tickMargin={10} />
				<YAxis tickLine={false} axisLine={false} tickMargin={8} width="auto" />
				<ChartTooltip content={<ChartTooltipContent />} />
				{spec.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
				{spec.series.map(({ key }) => mark(key, `var(--color-${key})`))}
			</Chart>
		</ChartContainer>
	);
}
