import { describe, expect, test } from "bun:test";
import { foldActivity } from "./activity";
import type { ActivityEvent, ActivityRow } from "./shared/activity";

const MIN = 60_000;
const DAY1 = new Date(2026, 9, 1, 10, 0).getTime();
const DAY2 = new Date(2026, 9, 2, 9, 0).getTime();
const A = "aaaaaaaa-0000-4000-8000-000000000000";
const B = "bbbbbbbb-0000-4000-8000-000000000000";

const rowsOf = (client: string, events: (Omit<ActivityEvent, "via"> & Partial<Pick<ActivityEvent, "via">>)[]): ActivityRow[] =>
	events.map((event, seq) => ({ client, seq, via: null, ...event }));

const ROWS: ActivityRow[] = [
	...rowsOf(A, [
		{ kind: "view", key: "home", at: DAY1 },
		{ kind: "command", key: "help", via: "keyboard", at: DAY1 + MIN },
		{ kind: "view", key: "pull-requests", at: DAY1 + 2 * MIN },
		// Six minutes on the pull requests, of which five count.
		{ kind: "action", key: "pin", at: DAY1 + 8 * MIN },
		{ kind: "view", key: "settings/sync", at: DAY1 + 9 * MIN },
		{ kind: "presence", key: "background", at: DAY1 + 10 * MIN },
		// 31 idle minutes since the last use: a second visit.
		{ kind: "presence", key: "foreground", at: DAY1 + 40 * MIN },
		{ kind: "view", key: "home", at: DAY1 + 42 * MIN },
	]),
	...rowsOf(B, [
		{ kind: "view", key: "todo", at: DAY2 },
		{ kind: "command", key: "help", via: "palette", at: DAY2 + MIN },
		{ kind: "view", key: "pull-requests", at: DAY2 + 2 * MIN },
	]),
];
const NOW = DAY2 + 3 * MIN;

describe("foldActivity", () => {
	test("counts uses, days, and the command's channels over two page loads and two days", () => {
		expect(foldActivity(ROWS, NOW).uses).toEqual([
			{ kind: "view", key: "home", count: 2, days: 1, lastAt: DAY1 + 42 * MIN, keyboard: 0, palette: 0 },
			{ kind: "command", key: "help", count: 2, days: 2, lastAt: DAY2 + MIN, keyboard: 1, palette: 1 },
			{ kind: "view", key: "pull-requests", count: 2, days: 2, lastAt: DAY2 + 2 * MIN, keyboard: 0, palette: 0 },
			{ kind: "action", key: "pin", count: 1, days: 1, lastAt: DAY1 + 8 * MIN, keyboard: 0, palette: 0 },
			{ kind: "view", key: "settings/sync", count: 1, days: 1, lastAt: DAY1 + 9 * MIN, keyboard: 0, palette: 0 },
			{ kind: "view", key: "todo", count: 1, days: 1, lastAt: DAY2, keyboard: 0, palette: 0 },
		]);
	});

	test("moves between views stay within one page load", () => {
		expect(foldActivity(ROWS, NOW).transitions).toEqual([
			{ from: "home", to: "pull-requests", count: 1 },
			{ from: "pull-requests", to: "settings/sync", count: 1 },
			{ from: "settings/sync", to: "home", count: 1 },
			{ from: "todo", to: "pull-requests", count: 1 },
		]);
	});

	test("dwell caps each gap at five minutes and skips the background", () => {
		// home: 1 + 1 + the last gap to now, capped at 5; pull requests: 5 of 6 + 1, then 1 on day two; settings: 1 + 2 after the return; todo: 2.
		expect(foldActivity(ROWS, NOW).dwell).toEqual([
			{ view: "home", ms: 7 * MIN },
			{ view: "pull-requests", ms: 7 * MIN },
			{ view: "settings/sync", ms: 3 * MIN },
			{ view: "todo", ms: 2 * MIN },
		]);
	});

	test("splits visits at a 31-minute gap and counts each day's active time and actions", () => {
		expect(foldActivity(ROWS, NOW).days).toEqual([
			{ day: "2026-10-01", activeMs: 16 * MIN, visits: 2, actions: 1 },
			{ day: "2026-10-02", activeMs: 3 * MIN, visits: 1, actions: 0 },
		]);
	});

	test("a range's rows fold alone: nothing before it counts", () => {
		const fold = foldActivity(ROWS.filter(({ at }) => at >= DAY2), NOW);
		expect(fold.uses.map(({ key }) => key)).toEqual(["todo", "help", "pull-requests"]);
		expect(fold.days).toEqual([{ day: "2026-10-02", activeMs: 3 * MIN, visits: 1, actions: 0 }]);
	});
});
