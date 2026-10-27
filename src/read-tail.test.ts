import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTail } from "./read-tail";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const file = (text: string): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-tail-"));
	dirs.push(dir);
	const path = join(dir, "log");
	writeFileSync(path, text);
	return path;
};

test("a file within the limit reads whole, and one past it as the whole lines of its end, without the line the cut split", () => {
	expect(readTail(file("one\ntwo\n"), 8)).toEqual({ text: "one\ntwo\n", cut: false });
	expect(readTail(file("one\ntwo\nthree\n"), 9)).toEqual({ text: "three\n", cut: true });
	expect(readTail(file("one\ntwo\nthree\n"), 10)).toEqual({ text: "two\nthree\n", cut: true });
});

test("a cut end with no line break holds no whole line, and a missing file reads as null", () => {
	expect(readTail(file("a long line with no end"), 5)).toEqual({ text: "", cut: true });
	expect(readTail(join(tmpdir(), "omp-agents-tail-missing", "log"), 5)).toBeNull();
});
