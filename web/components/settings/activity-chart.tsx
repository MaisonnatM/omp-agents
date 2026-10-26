/** Settings › Activity's active minutes per day, drawn with `recharts`, a chunk of its own the tab loads on first use. */
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ActivityDay } from "../../../src/shared/activity";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const CONFIG: ChartConfig = { minutes: { label: "Active minutes", color: "var(--chart-1)" } };

export function ActivityChart({ days }: { days: ActivityDay[] }) {
	const data = days.map(({ day, activeMs }) => ({ day, minutes: Math.round(activeMs / 60_000) }));
	return (
		<ChartContainer config={CONFIG} role="figure" aria-label="Active minutes per day" className="aspect-auto h-48 w-full">
			<BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={10} />
				<YAxis tickLine={false} axisLine={false} tickMargin={8} width="auto" />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Bar dataKey="minutes" fill="var(--color-minutes)" radius={4} />
			</BarChart>
		</ChartContainer>
	);
}
