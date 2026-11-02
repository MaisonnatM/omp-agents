import { describe, expect, test } from "bun:test";
import type { AgentSettingRow, AgentSettingTab } from "../src/shared/agent-settings";
import { GC_RULES } from "../src/shared/storage";
import { formatValue, isChanged, ownerOf, shownTabs, valueOf } from "./omp-settings";

const toggle = (id: string, layers: Partial<AgentSettingRow> = {}): AgentSettingRow => ({
	id,
	label: id,
	description: `What ${id} does`,
	control: { kind: "toggle" },
	default: true,
	credential: false,
	...layers,
});

describe("ownerOf", () => {
	test("Models owns the retry settings it lists, and no other", () => {
		expect(ownerOf("retry.maxRetries")).toEqual({ section: "models", label: "Models" });
		expect(ownerOf("modelRoles")?.section).toBe("models");
		expect(ownerOf("retry.fallbackOn")).toBeUndefined();
		expect(ownerOf("constructor")).toBeUndefined();
	});
	test("Storage owns every cleanup rule, but not unknown future settings", () => {
		for (const rule of GC_RULES) expect(ownerOf(rule.id)).toEqual({ section: "storage", label: "Storage" });
		expect(ownerOf("gc.future")).toBeUndefined();
	});
});

describe("valueOf and isChanged", () => {
	test("the workspace's value wins over the user's, which wins over omp's default", () => {
		expect(valueOf(toggle("a"))).toBe(true);
		expect(valueOf(toggle("a", { user: false }))).toBe(false);
		expect(valueOf(toggle("a", { user: false, workspace: true }))).toBe(true);
		expect(isChanged(toggle("a", { user: true }))).toBe(false);
		expect(isChanged(toggle("a", { user: false }))).toBe(true);
	});

	test("a credential counts as changed once any layer sets it", () => {
		const secret = (layers: Partial<AgentSettingRow>): AgentSettingRow => ({ ...toggle("key", layers), control: { kind: "text", secret: true }, default: undefined, credential: true });
		expect(isChanged(secret({}))).toBe(false);
		expect(isChanged(secret({ user: true }))).toBe(true);
		expect(formatValue(secret({ user: true }), true)).toBe("Set");
		expect(formatValue(secret({}), undefined)).toBe("Not set");
	});
});

describe("formatValue", () => {
	test("names a value as the row's control does", () => {
		const select: AgentSettingRow = { ...toggle("level"), control: { kind: "select", options: [{ value: -1, label: "Default" }, { value: 50, label: "50%" }] }, default: -1 };
		expect(formatValue(select, -1)).toBe("Default");
		expect(formatValue(select, 42)).toBe("42");
		expect(formatValue(toggle("on"), false)).toBe("Off");
		const ordered: AgentSettingRow = { ...toggle("order"), control: { kind: "list", ordered: true, options: [{ value: "remote", label: "Server" }, { value: "local", label: "Local" }] }, default: [] };
		expect(formatValue(ordered, ["local", "remote"])).toBe("Local → Server");
		expect(formatValue(ordered, [])).toBe("None");
		const limits: AgentSettingRow = { ...toggle("limits"), control: { kind: "provider-limits" }, default: {} };
		expect(formatValue(limits, { openai: 4 })).toBe("openai: 4");
		expect(formatValue(limits, {})).toBe("No limit");
	});
});

describe("shownTabs", () => {
	const tabs: AgentSettingTab[] = [
		{
			id: "model",
			label: "Model",
			groups: [
				{ label: "Thinking", rows: [toggle("thinking.show", { user: false })] },
				{ label: "Retry & Fallback", rows: [toggle("retry.maxRetries", { user: false }), toggle("retry.enabled"), toggle("retry.fallbackOn")] },
			],
		},
		{ id: "shell", label: "Shell", groups: [{ label: null, rows: [toggle("bash.enabled")] }] },
	];

	test("another section's settings are counted by owner, and only this section's count as changed", () => {
		const [model] = shownTabs(tabs, "");
		expect(model?.changed).toBe(1);
		expect(model?.groups[1]).toEqual({ label: "Retry & Fallback", rows: [toggle("retry.fallbackOn")], owned: [{ owner: { section: "models", label: "Models" }, count: 2 }] });
	});

	test("a search keeps the rows holding every word, in any tab, and drops empty groups", () => {
		const shown = shownTabs(tabs, "bash");
		expect(shown.map(tab => tab.groups.map(group => group.rows.map(row => row.id)))).toEqual([[], [["bash.enabled"]]]);
		expect(shownTabs(tabs, "thinking off").map(tab => tab.groups.length)).toEqual([1, 0]);
		expect(shownTabs(tabs, "nothing here").every(tab => tab.groups.length === 0)).toBe(true);
	});
});
