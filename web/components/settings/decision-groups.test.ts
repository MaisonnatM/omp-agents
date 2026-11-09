import { describe, expect, test } from "bun:test";
import { decisionGroups, visibleRecords, type DecisionRead } from "./decision-groups";
import type { DecisionRecord } from "../../../src/shared/models";

const record = (name: string, status: string | null): DecisionRecord => ({
	name,
	title: name,
	status,
	date: "2026-01-01",
	decisionMakers: [],
	supersedes: [],
	supersededBy: [],
	body: "",
});

const read = (cwd: string, records: DecisionRecord[] | null, error: string | null = null): DecisionRead => ({
	cwd,
	cwdDisplay: cwd,
	data: error !== null || records === null ? null : { dir: `${cwd}/docs/decisions`, dirDisplay: `${cwd}/docs/decisions`, records },
	error,
});

describe("decision groups", () => {
	test("keeps a failed read, drops a workspace with no records, and preserves order", () => {
		const { groups, empty } = decisionGroups([
			read("/a", null, "Cannot read"),
			read("/b", []),
			read("/c", null),
			read("/d", [record("keep", "accepted")]),
		]);
		expect(empty).toBe(1);
		expect(groups.map(group => group.cwd)).toEqual(["/a", "/c", "/d"]);
		expect(groups[0]).toMatchObject({ error: "Cannot read" });
		expect(groups[1]).toMatchObject({ error: "No answer" });
		expect(groups[2]).toMatchObject({ error: null, records: [record("keep", "accepted")] });
	});

	test("in force hides a retired record, and a search miss is not a hidden record", () => {
		const records = [record("live", "accepted"), record("old", "superseded")];
		expect(visibleRecords(records, "", true)).toEqual({ shown: [record("live", "accepted")], hidden: 1 });
		expect(visibleRecords(records, "", false).shown.map(item => item.name)).toEqual(["live", "old"]);
		expect(visibleRecords(records, "missing", true)).toEqual({ shown: [], hidden: 0 });
		expect(visibleRecords(records, "old", true)).toEqual({ shown: [], hidden: 1 });
	});
});
