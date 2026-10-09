/** Tests for `JsonFile`'s coalesced saves and `flushJsonFiles`. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles, JsonFile } from "./fs";

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
