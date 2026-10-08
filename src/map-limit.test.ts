import { describe, expect, test } from "bun:test";
import { mapLimit } from "./map-limit";

describe("mapLimit", () => {
	test("returns the results in the items' order and never runs more than the limit at once", async () => {
		let running = 0;
		let most = 0;
		const result = await mapLimit([0, 1, 2, 3, 4], 2, async index => {
			running++;
			most = Math.max(most, running);
			// Later items finish first, so a result in the wrong place shows.
			for (let turn = 0; turn < 5 - index; turn++) await Promise.resolve();
			running--;
			return index * 10;
		});
		expect(result).toEqual([0, 10, 20, 30, 40]);
		expect(most).toBe(2);
	});

	test("no items resolve to no results, and the first rejection rejects", async () => {
		expect(await mapLimit([], 3, async () => 1)).toEqual([]);
		await expect(mapLimit([1, 2], 2, async n => (n === 2 ? Promise.reject(new Error("no")) : n))).rejects.toThrow("no");
	});
});
