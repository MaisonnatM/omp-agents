import { expect, test } from "bun:test";
import { parseClientMsg } from "./server/wire";
import type { SportChange } from "./shared/sport";
import { log } from "./sport-fixtures";

const change = (value: unknown): unknown => parseClientMsg(JSON.stringify({ t: "module-change", id: "sport", change: value }))?.ok ?? null;

test("a Sport change from the page is a whole list of changes, refused when one is wrong", () => {
	const restore: SportChange = { op: "restore-log", log: log("l1", "2026-11-17"), index: 0 };
	expect(change([{ op: "remove-log", id: "l1", extra: 1 }, restore])).toEqual({ t: "module-change", id: "sport", change: [{ op: "remove-log", id: "l1" }, restore] });
	expect(change([])).toBeNull();
	expect(change([{ op: "remove-log", id: "l1" }, { op: "remove-log", id: "" }])).toBeNull();
	expect(change({ op: "remove-log", id: "l1" })).toBeNull();
	expect(change(undefined)).toBeNull();
});
