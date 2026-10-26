import { describe, expect, test } from "bun:test";
import { applyPreference, parsePagePreferences } from "./preferences";

describe("applyPreference", () => {
	test("the first seed sets the preferences, keeping only portable keys, and a later seed changes nothing", () => {
		const seeded = applyPreference(null, { op: "seed", values: { "omp-agents.theme": "dark", "omp-agents.split-columns": "0.4" } });
		expect(seeded).toEqual({ "omp-agents.theme": "dark" });
		expect(applyPreference(seeded, { op: "seed", values: { "omp-agents.theme": "light" } })).toBe(seeded);
		expect(applyPreference(null, { op: "seed", values: {} })).toEqual({});
	});

	test("a set stores a string and removes the key with null, starting from none before any seed", () => {
		const set = applyPreference(null, { op: "set", key: "omp-agents.hide-thinking", value: "true" });
		expect(set).toEqual({ "omp-agents.hide-thinking": "true" });
		const both = applyPreference(set, { op: "set", key: "omp-agents.theme", value: "light" });
		expect(both).toEqual({ "omp-agents.hide-thinking": "true", "omp-agents.theme": "light" });
		expect(applyPreference(both, { op: "set", key: "omp-agents.hide-thinking", value: null })).toEqual({ "omp-agents.theme": "light" });
	});

	test("a set that changes nothing, or names a key that stays on this machine, returns the same preferences", () => {
		const values = { "omp-agents.theme": "dark" };
		expect(applyPreference(values, { op: "set", key: "omp-agents.theme", value: "dark" })).toBe(values);
		expect(applyPreference(values, { op: "set", key: "omp-agents.pinned-skill", value: null })).toBe(values);
		expect(applyPreference(values, { op: "set", key: "omp-agents.split-columns", value: "0.4" })).toBe(values);
		expect(applyPreference(null, { op: "set", key: "omp-agents.split-columns", value: "0.4" })).toBeNull();
	});
});

describe("parsePagePreferences", () => {
	test("takes strings under portable keys, and refuses another key, a value that is not a string, or a list", () => {
		expect(parsePagePreferences({ "omp-agents.theme": "dark", "omp-agents.sidebar-tabs": "[]" })).toEqual({ "omp-agents.theme": "dark", "omp-agents.sidebar-tabs": "[]" });
		expect(parsePagePreferences({})).toEqual({});
		expect(parsePagePreferences({ "omp-agents.theme": "dark", "omp-agents.split-columns": "0.4" })).toBeNull();
		expect(parsePagePreferences({ "omp-agents.theme": null })).toBeNull();
		expect(parsePagePreferences(["dark"])).toBeNull();
		expect(parsePagePreferences(null)).toBeNull();
	});
});
