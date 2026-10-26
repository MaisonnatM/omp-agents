import { describe, expect, test } from "bun:test";
import type { ActivityUse } from "../src/shared/activity";
import { type Feature, report } from "./activity-report";

const FEATURES: Feature[] = [
	{ kind: "command", key: "new-session", label: "New session" },
	{ kind: "command", key: "help", label: "Help" },
	{ kind: "command", key: "tools", label: "Toggle tool calls" },
	{ kind: "view", key: "todo", label: "Todo" },
	{ kind: "view", key: "notes", label: "Notes" },
	{ kind: "view", key: "inbox", label: "Inbox", integration: "gmail" },
];

const use = (kind: ActivityUse["kind"], key: string, count: number): ActivityUse => ({ kind, key, count, days: 1, lastAt: 10, keyboard: 0, palette: 0 });

describe("report", () => {
	test("splits features into used, rarely used, never used with their last use, and not set up", () => {
		const answer = {
			uses: [use("command", "new-session", 5), use("view", "todo", 2)],
			lastUsed: [{ kind: "command" as const, key: "help", at: 3 }],
		};
		const result = report(FEATURES, answer, new Set());
		expect(result.used.map(({ key }) => key)).toEqual(["new-session"]);
		expect(result.rarely.map(({ key }) => key)).toEqual(["todo"]);
		expect(result.never.map(({ key, lastAt }) => [key, lastAt])).toEqual([["help", 3], ["tools", null], ["notes", null]]);
		expect(result.notSetUp.map(({ key }) => key)).toEqual(["inbox"]);
	});

	test("a gated feature counts once its service is set up", () => {
		const result = report(FEATURES, { uses: [], lastUsed: [] }, new Set(["gmail"]));
		expect(result.notSetUp).toEqual([]);
		expect(result.never.map(({ key }) => key)).toContain("inbox");
	});
});
