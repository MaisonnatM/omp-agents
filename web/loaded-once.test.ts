import { expect, test } from "bun:test";
import { loadedOnce } from "./loaded-once";

test("a load whose maker rejects lands on the fallback, so the page renders without the chunk", async () => {
	let makes = 0;
	const loaded = loadedOnce<string[]>(() => {
		makes += 1;
		return Promise.reject(new Error("chunk failed to load"));
	}, []);
	expect(await loaded.load()).toEqual([]);
	expect(loaded.value).toEqual([]);
	expect(await loaded.load()).toEqual([]);
	expect(makes).toBe(1);
});
