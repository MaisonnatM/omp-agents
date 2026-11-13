import { expect, test } from "bun:test";
import { moveBy, moveKey, stepTarget } from "./order";

test("moving a key puts it beside its target; a missing key or target changes nothing; a step at the edge has no target", () => {
	expect(moveKey(["a", "b", "c", "d"], "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
	expect(moveKey(["a", "b", "c", "d"], "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
	expect(moveKey(["a", "b"], "x", "a", "before")).toEqual(["a", "b"]);
	expect(stepTarget(["a", "b", "c"], "b", -1)).toEqual({ target: "a", where: "before" });
	expect(stepTarget(["a", "b", "c"], "c", 1)).toBeNull();
});

test("moving an item by its key keeps the item and moves it as its key moves", () => {
	const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
	const id = (item: { id: string }): string => item.id;
	const moved = moveBy(items, id, "a", "c", "after");
	expect(moved.map(id)).toEqual(["b", "c", "a"]);
	expect(moved[2]).toBe(items[0]!);
	expect(moveBy(items, id, "x", "a", "before")).toEqual(items);
	expect(moveBy(items, id, "a", "x", "before")).toEqual(items);
});
