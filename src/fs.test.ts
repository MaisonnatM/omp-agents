/** Tests for `JsonFile`'s coalesced saves and `flushJsonFiles`, and `ReducerFile`'s changes. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles, JsonFile, ReducerFile } from "./fs";
import { isObject } from "./json";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function numbersIn(): { path: string; file: JsonFile<number[]> } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-fs-"));
	dirs.push(dir);
	const path = join(dir, "numbers.json");
	const parse = (json: unknown): number[] | null => (Array.isArray(json) && json.every(n => typeof n === "number") ? json : null);
	return { path, file: new JsonFile(path, { parse, holds: "a list of numbers", onInvalid: "ignore" }) };
}

test("saves within one tick write once, at the end of it, with the last value", async () => {
	const { path, file } = numbersIn();
	file.save([1]);
	file.save([1, 2]);
	expect(existsSync(path)).toBe(false);
	const { promise, resolve } = Promise.withResolvers<void>();
	setImmediate(resolve);
	await promise;
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([1, 2]);
});

test("flushJsonFiles writes a saved value at once, and a load reads what another store of the path saved", () => {
	const { path, file } = numbersIn();
	file.save([3]);
	flushJsonFiles();
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([3]);
	file.save([4]);
	const parse = (json: unknown): number[] | null => (Array.isArray(json) ? json : null);
	expect(new JsonFile(path, { parse, holds: "a list", onInvalid: "ignore" }).load()).toEqual([4]);
});

function countsIn(shared: boolean): { path: string; open: () => ReducerFile<number[], [add: number]> } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-fs-"));
	dirs.push(dir);
	const path = join(dir, "counts.json");
	const parse = (json: unknown): number[] | null => (isObject(json) && Array.isArray(json.counts) && json.counts.every(n => typeof n === "number") ? json.counts : null);
	const open = () =>
		new ReducerFile<number[], [add: number]>(path, {
			parse,
			toJson: counts => ({ counts }),
			holds: "a list of counts",
			empty: [],
			reduce: (counts, add) => (counts.includes(add) ? counts : [...counts, add]),
			shared,
		});
	return { path, open };
}

test("a change that changes nothing saves nothing, and what a change saves is wrapped by toJson", () => {
	const { path, open } = countsIn(false);
	const file = open();
	expect(file.value).toEqual([]);
	expect(file.apply(1)).toBe(true);
	expect(file.apply(1)).toBe(false);
	file.flush();
	expect(readFileSync(path, "utf8")).toBe('{\n\t"counts": [\n\t\t1\n\t]\n}\n');
	expect(open().value).toEqual([1]);
});

test("a shared file reads what another store saved before it applies a change; an unshared one keeps its own", () => {
	const shared = countsIn(true);
	const [mine, theirs] = [shared.open(), shared.open()];
	theirs.apply(2);
	expect(mine.apply(3)).toBe(true);
	expect(mine.value).toEqual([2, 3]);

	const own = countsIn(false);
	const [first, second] = [own.open(), own.open()];
	second.apply(2);
	first.apply(3);
	expect(first.value).toEqual([3]);
});
