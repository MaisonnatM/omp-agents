import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PinsFile } from "./pins-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pinsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-pins-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "pins.json");
}

describe("PinsFile", () => {
	test("a change that changes the pins saves them for the next server, and one that changes nothing says so", () => {
		const path = pinsPath();
		const first = new PinsFile(path);
		expect(first.sessionIds).toEqual([]);
		expect(first.apply({ op: "pin", sessionIds: ["s1", "s2"] })).toBe(true);
		expect(first.apply({ op: "pin", sessionIds: ["s1"] })).toBe(false);
		expect(first.apply({ op: "unpin", sessionIds: ["s3"] })).toBe(false);
		expect(new PinsFile(path).sessionIds).toEqual(["s1", "s2"]);
		expect(first.apply({ op: "unpin", sessionIds: ["s1"] })).toBe(true);
		expect(new PinsFile(path).sessionIds).toEqual(["s2"]);
	});

	test("a file that holds something other than session ids moves aside rather than being written over", () => {
		const path = pinsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ sessions: [7] }));
		expect(new PinsFile(path).sessionIds).toEqual([]);
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});
