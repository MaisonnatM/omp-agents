import { describe, expect, test } from "bun:test";
import { createCache } from "./cache";

describe("createCache", () => {
	test("callers of one key share an answer until it is dropped or asked for fresh", async () => {
		const cache = createCache<number>();
		let loads = 0;
		const load = async () => ++loads;
		expect(await cache.get("a", load)).toBe(1);
		expect(await cache.get("a", load)).toBe(1);
		expect(await cache.get("a", load, true)).toBe(2);
		cache.drop("a");
		expect(await cache.get("a", load)).toBe(3);
	});

	test("a failed load is not kept, so the next caller asks again", async () => {
		const cache = createCache<number>();
		await expect(cache.get("a", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
		expect(await cache.get("a", async () => 7)).toBe(7);
	});

	test("dropWhere forgets the keys it matches and keeps the rest", async () => {
		const cache = createCache<string>();
		for (const key of ["s1\0/a", "s1\0/b", "s2\0/a"]) await cache.get(key, async () => "old");
		cache.dropWhere(key => key.startsWith("s1\0"));
		expect(await cache.get("s1\0/a", async () => "new")).toBe("new");
		expect(await cache.get("s1\0/b", async () => "new")).toBe("new");
		expect(await cache.get("s2\0/a", async () => "new")).toBe("old");
	});
});
