/** The time range Settings › Analytics and Settings › Activity read over: its picker, and a read that keeps the last answer while the next range loads. */
import { useEffect, useState } from "react";
import { ANALYTICS_RANGES, type AnalyticsRange } from "../../../src/shared/analytics";
import { Button } from "@/components/ui/button";
import type { PolledEntry } from "../../polled-store";

const rangeLabel: Record<AnalyticsRange, string> = { today: "Today", "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };

/** A polled store whose scope is the range. */
interface RangedStore<T> {
	use(scope: string | null): PolledEntry<T>;
	refresh(scope: string | null): Promise<void>;
}

/**
 * `store`'s read over the chosen range, `initial` at first, read again while `active` and on each change. `data` is the
 * last answer, kept while the next range loads, which `switching` says, unless the read failed.
 */
export function useRangedRead<T extends { range: AnalyticsRange }>(store: RangedStore<T>, initial: AnalyticsRange, active: boolean) {
	const [range, setRange] = useState(initial);
	const entry = store.use(range);
	const answer = entry.read?.data ?? null;
	const [last, setLast] = useState<T | null>(null);
	if (answer !== null && answer !== last) setLast(answer);
	const { error } = entry;
	const data = answer ?? (error === null ? last : null);
	useEffect(() => {
		if (active) void store.refresh(range);
	}, [store, active, range]);
	return { range, setRange, data, error, switching: data !== null && data.range !== range };
}

export function RangePicker({ range, onChange }: { range: AnalyticsRange; onChange(range: AnalyticsRange): void }) {
	return (
		<div role="group" aria-label="Time range" className="flex flex-wrap gap-1">
			{ANALYTICS_RANGES.map(option => (
				<Button key={option} variant="ghost" size="compact" active={option === range} aria-pressed={option === range} onClick={() => onChange(option)}>
					{rangeLabel[option]}
				</Button>
			))}
		</div>
	);
}
