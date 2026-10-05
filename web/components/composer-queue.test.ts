import { describe, expect, test } from "bun:test";
import { queuedEntries } from "./composer-queue";

describe("queuedEntries", () => {
	test("lists steers before follow-ups, each with its tag, as ↑ takes them back", () => {
		const entries = queuedEntries({ steering: ["a"], followUp: ["b"] });
		expect(entries.map(({ queue, item }) => [queue, item.tag, item.text])).toEqual([
			["steering", "Steer", "a"],
			["followUp", "Follow-up", "b"],
		]);
	});

	test("a row keeps its key when an earlier row with the same text is delivered", () => {
		const before = queuedEntries({ steering: ["go", "go"], followUp: [] }).map(({ item }) => item.id);
		expect(new Set(before).size).toBe(2);
		const after = queuedEntries({ steering: ["go"], followUp: [] }).map(({ item }) => item.id);
		expect(after).toEqual([before[0]]);
	});

	test("a queue that is not there yet lists nothing", () => {
		expect(queuedEntries(undefined)).toEqual([]);
	});
});
