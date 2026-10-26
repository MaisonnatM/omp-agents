/** Folds the stored activity rows of a range into Settings › Activity's answer. */
import { type ActivityDay, type ActivityFold, type ActivityRow, type ActivityUse, featureId } from "./shared/activity";
import { localDay } from "./shared/days";

/** The most foreground time one gap between two events counts, so a window left open while away does not count as use. */
export const DWELL_CAP_MS = 5 * 60_000;
/** An idle gap this long or longer starts a new visit. */
export const VISIT_GAP_MS = 30 * 60_000;

const byCountDesc = <T>(count: (item: T) => number) => (a: T, b: T): number => count(b) - count(a);

/** Each feature's uses in `rows`, most first, with the local days it was used on and, for a command, how it ran. */
function countUses(rows: readonly ActivityRow[]): ActivityUse[] {
	const uses = new Map<string, ActivityUse & { daySet: Set<string> }>();
	for (const row of rows) {
		if (row.kind === "presence") continue;
		const id = featureId(row.kind, row.key);
		let use = uses.get(id);
		if (!use) uses.set(id, (use = { kind: row.kind, key: row.key, count: 0, days: 0, lastAt: row.at, keyboard: 0, palette: 0, daySet: new Set() }));
		use.count++;
		use.daySet.add(localDay(row.at));
		use.lastAt = Math.max(use.lastAt, row.at);
		if (row.via === "keyboard") use.keyboard++;
		if (row.via === "palette") use.palette++;
	}
	return [...uses.values()].map(({ daySet, ...use }) => ({ ...use, days: daySet.size })).sort(byCountDesc(use => use.count));
}

/** One page load's moves from one view to the next, and its foreground spans: from each event to the next, capped at {@link DWELL_CAP_MS}, on the view shown then, the last running to `now`. */
interface Timeline {
	moves: { from: string; to: string }[];
	spans: { view: string | null; at: number; ms: number }[];
}

/** {@link Timeline} of one page load's `rows` in sequence; it counts as in the foreground until its first `presence` says otherwise. */
function timeline(rows: readonly ActivityRow[], now: number): Timeline {
	const moves: Timeline["moves"] = [];
	const spans: Timeline["spans"] = [];
	let foreground = true;
	let view: string | null = null;
	rows.forEach((row, index) => {
		if (row.kind === "presence") foreground = row.key === "foreground";
		if (row.kind === "view") {
			if (view !== null && view !== row.key) moves.push({ from: view, to: row.key });
			view = row.key;
		}
		const ms = Math.min(Math.max((rows[index + 1]?.at ?? now) - row.at, 0), DWELL_CAP_MS);
		if (foreground && ms > 0) spans.push({ view, at: row.at, ms });
	});
	return { moves, spans };
}

/** The times in `times` that start a visit: the first, any after an idle gap of {@link VISIT_GAP_MS}, and the first of each local day. */
function visitStarts(times: number[]): number[] {
	const sorted = times.toSorted((a, b) => a - b);
	return sorted.filter((at, index) => {
		const before = sorted[index - 1];
		return before === undefined || at - before >= VISIT_GAP_MS || localDay(before) !== localDay(at);
	});
}

/**
 * What a range's `rows` say up to `now`: each feature's uses, the moves between views within one page load, foreground
 * time per view, and per local day the active time, the visits, and the action count.
 */
export function foldActivity(rows: readonly ActivityRow[], now: number): ActivityFold {
	const days = new Map<string, ActivityDay>();
	const dayOf = (at: number): ActivityDay => {
		const day = localDay(at);
		let entry = days.get(day);
		if (!entry) days.set(day, (entry = { day, activeMs: 0, visits: 0, actions: 0 }));
		return entry;
	};
	const clients = Map.groupBy(rows, row => row.client);
	const transitions = new Map<string, { from: string; to: string; count: number }>();
	const dwell = new Map<string, number>();
	for (const list of clients.values()) {
		const { moves, spans } = timeline(list.toSorted((a, b) => a.seq - b.seq), now);
		for (const { from, to } of moves) {
			const id = `${from}>${to}`;
			const move = transitions.get(id);
			if (move) move.count++;
			else transitions.set(id, { from, to, count: 1 });
		}
		for (const { view, at, ms } of spans) {
			dayOf(at).activeMs += ms;
			if (view !== null) dwell.set(view, (dwell.get(view) ?? 0) + ms);
		}
	}
	for (const row of rows) if (row.kind === "action") dayOf(row.at).actions++;
	for (const at of visitStarts(rows.filter(row => row.kind !== "presence" || row.key === "foreground").map(row => row.at))) dayOf(at).visits++;

	return {
		uses: countUses(rows),
		transitions: [...transitions.values()].sort(byCountDesc(move => move.count)),
		dwell: [...dwell].map(([view, ms]) => ({ view, ms })).sort(byCountDesc(entry => entry.ms)),
		days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
	};
}
