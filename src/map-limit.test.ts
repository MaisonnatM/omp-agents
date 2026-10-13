import { describe, expect, test } from "bun:test";
import { limit, mapLimit } from "./map-limit";

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

describe("limit", () => {
	test("runs at most its slots at once, in the order the tasks arrive, and frees a slot when a task rejects", async () => {
		const gate = limit(2);
		let running = 0;
		let most = 0;
		const started: number[] = [];
		const task = (index: number) =>
			gate(async () => {
				started.push(index);
				running++;
				most = Math.max(most, running);
				for (let turn = 0; turn < 3; turn++) await Promise.resolve();
				running--;
				if (index === 0) throw new Error("no");
				return index;
			});
		const answers = await Promise.allSettled([0, 1, 2, 3, 4].map(task));
		expect(answers.map(answer => (answer.status === "fulfilled" ? answer.value : "rejected"))).toEqual(["rejected", 1, 2, 3, 4]);
		expect(started).toEqual([0, 1, 2, 3, 4]);
		expect(most).toBe(2);
	});
});
