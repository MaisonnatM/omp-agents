import { describe, expect, test } from "bun:test";
import { ACTIVITY_KEY, type ActivityUse, featureId } from "../src/shared/activity";
import { VIEWS } from "./activity";
import { type Feature, inventory, report } from "./activity-report";
import { SETTINGS_SECTIONS } from "./routing";

const FEATURES: Feature[] = [
	{ kind: "command", key: "new-session", label: "New session" },
	{ kind: "command", key: "help", label: "Help" },
	{ kind: "command", key: "tools", label: "Toggle tool calls" },
	{ kind: "view", key: "todo", label: "Todo" },
	{ kind: "view", key: "notes", label: "Notes" },
	{ kind: "view", key: "inbox", label: "Inbox", tab: "inbox" },
];

const use = (kind: ActivityUse["kind"], key: string, count: number): ActivityUse => ({ kind, key, count, days: 1, lastAt: 10, keyboard: 0, palette: 0 });

describe("inventory", () => {
	const features = inventory(["/api/todo", "/api/ticket/new", "/api/gmail/send"]);
	const keys = (kind: Feature["kind"]): string[] => features.filter(feature => feature.kind === kind).map(({ key }) => key);

	test("lists every view the recorder names: each of VIEWS and each settings section", () => {
		expect(keys("view")).toEqual([...VIEWS.map(({ key }) => key), ...SETTINGS_SECTIONS.map(({ value }) => `settings/${value}`)]);
	});

	test("names each feature once, under a key the server takes", () => {
		const ids = features.map(({ kind, key }) => featureId(kind, key));
		expect(new Set(ids).size).toBe(ids.length);
		expect(features.filter(({ key }) => !ACTIVITY_KEY.test(key))).toEqual([]);
	});

	test("gates the Tickets and Inbox views, commands, and routes on their tab", () => {
		const tabOf = (kind: Feature["kind"], key: string) => features.find(feature => feature.kind === kind && feature.key === key)?.tab;
		expect(tabOf("view", "tickets/item")).toBe("tickets");
		expect(tabOf("view", "inbox/new")).toBe("inbox");
		expect(tabOf("command", "new-ticket")).toBe("tickets");
		expect(tabOf("command", "inbox-reply")).toBe("inbox");
		expect(tabOf("action", "put /api/ticket/new")).toBe("tickets");
		expect(tabOf("action", "put /api/gmail/send")).toBe("inbox");
		expect(tabOf("action", "put /api/todo")).toBeUndefined();
	});
});

describe("report", () => {
	test("splits features into used, rarely used, never used with their last use, and not set up", () => {
		const answer = {
			uses: [use("command", "new-session", 5), use("view", "todo", 2)],
			lastUsed: [{ kind: "command" as const, key: "help", at: 3 }],
		};
		const result = report(FEATURES, answer, new Set(["inbox"]));
		expect(result.used.map(({ key }) => key)).toEqual(["new-session"]);
		expect(result.rarely.map(({ key }) => key)).toEqual(["todo"]);
		expect(result.never.map(({ key, lastAt }) => [key, lastAt])).toEqual([["help", 3], ["tools", null], ["notes", null]]);
		expect(result.notSetUp.map(({ key }) => key)).toEqual(["inbox"]);
	});

	test("a gated feature counts once its tab is signed in", () => {
		const result = report(FEATURES, { uses: [], lastUsed: [] }, new Set());
		expect(result.notSetUp).toEqual([]);
		expect(result.never.map(({ key }) => key)).toContain("inbox");
	});

	test("most used is the used then the rarely used, most first, at most 20", () => {
		const many: Feature[] = Array.from({ length: 25 }, (_, index) => ({ kind: "control", key: `c${index}`, label: `C${index}` }));
		const result = report(many, { uses: many.map(({ key }, index) => use("control", key, index + 1)), lastUsed: [] }, new Set());
		expect(result.mostUsed.map(({ key }) => key)).toEqual(Array.from({ length: 20 }, (_, index) => `c${24 - index}`));
	});
});
