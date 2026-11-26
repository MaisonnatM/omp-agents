import { describe, expect, test } from "bun:test";
import { ACTIVITY_KEY, type ActivityUse, featureId } from "../src/shared/activity";
import { VIEWS } from "./activity";
import { type Feature, inventory, report } from "./activity-report";
import { SETTINGS_SECTIONS } from "./routing";

const FEATURES: Feature[] = [
	{ kind: "command", key: "new-session", label: "New session" },
	{ kind: "command", key: "help", label: "Help" },
	{ kind: "command", key: "tools", label: "Toggle tool calls" },
	{ kind: "view", key: "bots", label: "Bots" },
	{ kind: "view", key: "sport", label: "Sport" },
];

const use = (kind: ActivityUse["kind"], key: string, count: number): ActivityUse => ({ kind, key, count, days: 1, lastAt: 10, keyboard: 0, palette: 0 });

describe("inventory", () => {
	const features = inventory(["/api/bots"]);
	const keys = (kind: Feature["kind"]): string[] => features.filter(feature => feature.kind === kind).map(({ key }) => key);

	test("lists every view the recorder names: each of VIEWS and each settings section", () => {
		expect(keys("view")).toEqual([...VIEWS.map(({ key }) => key), ...SETTINGS_SECTIONS.map(({ value }) => `settings/${value}`)]);
	});

	test("names each feature once, under a key the server takes", () => {
		const ids = features.map(({ kind, key }) => featureId(kind, key));
		expect(new Set(ids).size).toBe(ids.length);
		expect(features.filter(({ key }) => !ACTIVITY_KEY.test(key))).toEqual([]);
	});
});

describe("report", () => {
	test("splits features into used, rarely used, and never used with their last use, leaving out uses of no feature", () => {
		const answer = {
			uses: [use("command", "new-session", 5), use("view", "bots", 2), use("view", "notes", 9)],
			lastUsed: [{ kind: "command" as const, key: "help", at: 3 }],
		};
		const result = report(FEATURES, answer);
		expect(result.used.map(({ key }) => key)).toEqual(["new-session"]);
		expect(result.rarely.map(({ key }) => key)).toEqual(["bots"]);
		expect(result.never.map(({ key, lastAt }) => [key, lastAt])).toEqual([["help", 3], ["tools", null], ["sport", null]]);
	});

	test("most used is the used then the rarely used, most first, at most 20", () => {
		const many: Feature[] = Array.from({ length: 25 }, (_, index) => ({ kind: "control", key: `c${index}`, label: `C${index}` }));
		const result = report(many, { uses: many.map(({ key }, index) => use("control", key, index + 1)), lastUsed: [] });
		expect(result.mostUsed.map(({ key }) => key)).toEqual(Array.from({ length: 20 }, (_, index) => `c${24 - index}`));
	});
});
