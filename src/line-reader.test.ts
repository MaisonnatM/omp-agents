import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FoldedFile } from "./line-reader";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A fold that keeps every line it was given. */
class Lines {
	readonly lines: string[] = [];
	applyLine(line: string): void {
		this.lines.push(line);
	}
}

function folded(): { path: string; file: FoldedFile<Lines> } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-folded-"));
	dirs.push(dir);
	const path = join(dir, "file.jsonl");
	return { path, file: new FoldedFile(path, () => new Lines()) };
}

describe("FoldedFile", () => {
	test("a file that does not exist yet folds nothing, then folds each complete line once as it is appended", async () => {
		const { path, file } = folded();
		expect(await file.read()).toEqual({ readable: true, restarted: false });
		expect(file.fold.lines).toEqual([]);

		writeFileSync(path, "one\n\ntw");
		await file.read();
		expect(file.fold.lines).toEqual(["one"]);

		appendFileSync(path, "o\nthree\n");
		await file.read();
		expect(file.fold.lines).toEqual(["one", "two", "three"]);
	});

	test("a file rewritten shorter starts a fresh fold from its first line, and appends then add to that fold", async () => {
		const { path, file } = folded();
		writeFileSync(path, "old one\nold two\n");
		await file.read();
		const old = file.fold;

		writeFileSync(path, "new\n");
		expect(await file.read()).toEqual({ readable: true, restarted: true });
		expect(file.fold).not.toBe(old);
		expect([old.lines, file.fold.lines]).toEqual([["old one", "old two"], ["new"]]);

		appendFileSync(path, "next\n");
		expect(await file.read()).toEqual({ readable: true, restarted: false });
		expect(file.fold.lines).toEqual(["new", "next"]);
	});

	test("reads asked for at once fold each appended line once", async () => {
		const { path, file } = folded();
		writeFileSync(path, "a\nb\n");
		await Promise.all([file.read(), file.read(), file.read()]);
		expect(file.fold.lines).toEqual(["a", "b"]);
	});
});
