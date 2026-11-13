import { expect, test } from "bun:test";
import { routeFromHash } from "../../routing";
import type { SportRoute } from "./module";
import { sportHash } from "./nav";

test("sport routes open the week on a day, the journal on a log, and the progress, and round-trip", () => {
	const routes: [SportRoute, string][] = [
		[{ tab: "week", day: null }, "#sport"],
		[{ tab: "week", day: "2026-11-17" }, "#sport?day=2026-11-17"],
		[{ tab: "journal", open: null }, "#sport/journal"],
		[{ tab: "journal", open: "log / 1" }, "#sport/journal?open=log%20%2F%201"],
		[{ tab: "progress" }, "#sport/progress"],
	];
	for (const [route, hash] of routes) {
		expect(sportHash(route)).toBe(hash);
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "sport", ...route } });
	}
	for (const day of ["17-11-2026", "2026-02-30", "2026-13-01"]) expect(routeFromHash(`#sport?day=${day}`)).toEqual({ kind: "page", page: { kind: "sport", tab: "week", day: null } });
	expect(routeFromHash("#sport/week")).toEqual({ kind: "page", page: { kind: "sport", tab: "week", day: null } });
});
