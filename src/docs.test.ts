import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Agents read these docs through tools that cut a line at 768 characters and end it with `…`.
 * A longer line hides its tail, and an edit that copies the cut line back writes the `…` into the file.
 * The docs keep one sentence per line, so no line comes near the cut.
 */
const MAX_LINE = 700;
const root = join(import.meta.dir, "..");
const docs = ["*.md", "docs/*.md", "templates/omp/*.md"].flatMap(pattern => [...new Bun.Glob(pattern).scanSync({ cwd: root })]).sort();

describe("docs stay readable by agents", () => {
	test.each(docs)("%s", async file => {
		const lines = (await Bun.file(join(root, file)).text()).split("\n");
		const problems = lines.flatMap((line, i) => {
			if (line.length > MAX_LINE) return [`line ${i + 1}: ${line.length} characters; put one sentence on each line`];
			if (line.trimEnd().endsWith("…")) return [`line ${i + 1}: ends in a tool's truncation mark "…"; restore the cut text`];
			return [];
		});
		expect(problems).toEqual([]);
	});
});
