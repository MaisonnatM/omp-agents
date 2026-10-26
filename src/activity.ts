/** Folds the stored activity rows into Settings › Activity's answer. */
import type { ActivityDay, ActivityFold, ActivityKind, ActivityRow, ActivityUse } from "./shared/activity";

/** The most foreground time one gap between two events counts, so a window left open while away does not count as use. */
export const DWELL_CAP_MS = 5 * 60_000;
/** An idle gap this long or longer starts a new visit. */
export const VISIT_GAP_MS = 30 * 60_000;

/** `at`'s local day, `YYYY-MM-DD`. */
export function localDay(at: number): string {
	const date = new Date(at);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const byCountDesc = <T>(count: (item: T) => number) => (a: T, b: T): number => count(b) - count(a);

/**
 * What `rows` say from `cutoff` (`null` for all time) up to `now`: each feature's uses in range, every feature's last use
 * whatever the range, the moves between views within one page load, foreground time per view with each gap capped at
 * {@link DWELL_CAP_MS}, and per local day the active time, the visits split at {@link VISIT_GAP_MS}, and the action count.
 * A page load counts as in the foreground until its first `presence` says otherwise, and its last gap runs to `now`.
 */
export function foldActivity(rows: readonly ActivityRow[], cutoff: number | null, now: number): ActivityFold {
	const inRange = (at: number): boolean => cutoff === null || at >= cutoff;
	const uses = new Map<string, ActivityUse & { daySet: Set<string> }>();
	const lastUsed = new Map<string, { kind: ActivityKind; key: string; at: number }>();
	const transitions = new Map<string, { from: string; to: string; count: number }>();
	const dwell = new Map<string, number>();
	const days = new Map<string, ActivityDay>();
	const dayOf = (at: number): ActivityDay => {
		const day = localDay(at);
		let entry = days.get(day);
		if (!entry) days.set(day, (entry = { day, activeMs: 0, visits: 0, actions: 0 }));
		return entry;
	};
	const clients = new Map<string, ActivityRow[]>();
	const visitTimes: number[] = [];

	for (const row of rows) {
		let list = clients.get(row.client);
		if (!list) clients.set(row.client, (list = []));
		list.push(row);
		if (row.kind === "presence") {
			if (row.key === "foreground" && inRange(row.at)) visitTimes.push(row.at);
			continue;
		}
		const id = `${row.kind}\u0000${row.key}`;
		const last = lastUsed.get(id);
		if (!last || row.at > last.at) lastUsed.set(id, { kind: row.kind, key: row.key, at: row.at });
		if (!inRange(row.at)) continue;
		visitTimes.push(row.at);
		let use = uses.get(id);
		if (!use) uses.set(id, (use = { kind: row.kind, key: row.key, count: 0, days: 0, lastAt: row.at, keyboard: 0, palette: 0, daySet: new Set() }));
		use.count++;
		use.daySet.add(localDay(row.at));
		use.lastAt = Math.max(use.lastAt, row.at);
		if (row.via === "keyboard") use.keyboard++;
		if (row.via === "palette") use.palette++;
		if (row.kind === "action") dayOf(row.at).actions++;
	}

	for (const list of clients.values()) {
		list.sort((a, b) => a.seq - b.seq);
		let foreground = true;
		let view: string | null = null;
		const credit = (from: number, to: number): void => {
			if (!foreground || !inRange(from)) return;
			const span = Math.min(Math.max(to - from, 0), DWELL_CAP_MS);
			if (span === 0) return;
			dayOf(from).activeMs += span;
			if (view !== null) dwell.set(view, (dwell.get(view) ?? 0) + span);
		};
		list.forEach((row, index) => {
			if (index > 0) credit(list[index - 1]!.at, row.at);
			if (row.kind === "presence") foreground = row.key === "foreground";
			if (row.kind !== "view") return;
			if (view !== null && view !== row.key && inRange(row.at)) {
				const id = `${view}\u0000${row.key}`;
				const move = transitions.get(id);
				if (move) move.count++;
				else transitions.set(id, { from: view, to: row.key, count: 1 });
			}
			view = row.key;
		});
		const last = list.at(-1);
		if (last) credit(last.at, now);
	}

	visitTimes.sort((a, b) => a - b);
	visitTimes.forEach((at, index) => {
		const before = visitTimes[index - 1];
		if (before === undefined || at - before >= VISIT_GAP_MS || localDay(before) !== localDay(at)) dayOf(at).visits++;
	});

	return {
		uses: [...uses.values()].map(({ daySet, ...use }) => ({ ...use, days: daySet.size })).sort(byCountDesc(use => use.count)),
		lastUsed: [...lastUsed.values()],
		transitions: [...transitions.values()].sort(byCountDesc(move => move.count)),
		dwell: [...dwell].map(([view, ms]) => ({ view, ms })).sort(byCountDesc(entry => entry.ms)),
		days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
	};
}
