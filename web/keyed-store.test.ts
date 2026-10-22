import { describe, expect, test } from "bun:test";
import { keyedStore } from "./keyed-store";

describe("keyed store", () => {
	test("a nullish value other than the empty one reads back as itself", () => {
		const store = keyedStore<string | null | undefined>(undefined);
		store.set("view", "board");
		store.set("view", null);
		expect(store.get("view")).toBeNull();
		store.set("view", undefined);
		expect(store.get("view")).toBeUndefined();
		expect([...store.keys()]).toEqual([]);
	});
});
