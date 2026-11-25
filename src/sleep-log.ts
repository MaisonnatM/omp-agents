/**
 * When the Mac slept, from `pmset -g log`. A span runs from a Sleep entry to the next full Wake: a dark wake does not
 * end it, since routines wait for a full wake before they run.
 */
import { run } from "./proc";

export interface SleepSpan {
	from: number;
	to: number;
}

/** A Sleep or full Wake entry; the event column pads each name, so `Wake Requests` and `DarkWake` do not match. */
const ENTRY = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d) (Sleep|Wake) {2}/gm;

/** The spans the Mac slept through, oldest first, as `pmset -g log` output lists them. */
export function sleepSpans(log: string): SleepSpan[] {
	const spans: SleepSpan[] = [];
	let since: number | null = null;
	for (const [, day, time, hours, minutes, kind] of log.matchAll(ENTRY)) {
		const at = Date.parse(`${day}T${time}${hours}:${minutes}`);
		if (kind === "Sleep") since ??= at;
		else if (since !== null) {
			spans.push({ from: since, to: at });
			since = null;
		}
	}
	return spans;
}

/** How long the Mac slept between `from` and `to`. */
export const sleptWithin = (spans: readonly SleepSpan[], from: number, to: number): number =>
	spans.reduce((total, span) => total + Math.max(0, Math.min(to, span.to) - Math.max(from, span.from)), 0);

/** The spans the Mac slept through; none off macOS or when `pmset` fails. */
export async function macSleeps(): Promise<SleepSpan[]> {
	if (process.platform !== "darwin") return [];
	const log = await run(["pmset", "-g", "log"], { timeoutMs: 30_000 }).catch(() => null);
	return log === null || log.code !== 0 ? [] : sleepSpans(log.stdout);
}
