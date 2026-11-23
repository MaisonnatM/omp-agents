import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Bun.serve closes a request idle for 10 seconds by default, which cut off the pull request list's slow GitHub reads,
 * so every server the app starts sets its own `idleTimeout`.
 */
const root = join(import.meta.dir, "..");

/** The 1-based line of each `Bun.serve(...)` call in `source` whose arguments never name `idleTimeout`. */
function servesWithoutIdleTimeout(source: string): number[] {
	const lines: number[] = [];
	for (const match of source.matchAll(/\bBun\.serve(?:<[^>()]*>)?\(/g)) {
		const start = match.index + match[0].length;
		let depth = 1;
		let end = start;
		while (end < source.length && depth > 0) {
			if (source[end] === "(") depth++;
			else if (source[end] === ")") depth--;
			end++;
		}
		const args = source.slice(start, end).replace(/\/\/.*$/gm, "");
		if (!/\bidleTimeout\b/.test(args)) lines.push(source.slice(0, match.index).split("\n").length);
	}
	return lines;
}

test("a Bun.serve call without idleTimeout is caught", () => {
	const bad = `const server = Bun.serve({\n\tport: 0,\n\t// idleTimeout: 120,\n\tfetch: () => new Response("ok"),\n});\n`;
	expect(servesWithoutIdleTimeout(bad)).toEqual([1]);
	const typed = `server = Bun.serve<Data>({ port: 0, idleTimeout: 120, fetch() { return new Response(String(f(1))); } });`;
	expect(servesWithoutIdleTimeout(typed)).toEqual([]);
});

test("every Bun.serve in src sets idleTimeout", () => {
	const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].filter(file => !file.endsWith(".test.ts")).sort();
	const serving = files.filter(file => readFileSync(join(root, file), "utf8").includes("Bun.serve"));
	expect(serving).toContain("src/server.ts");
	const problems = serving.flatMap(file => servesWithoutIdleTimeout(readFileSync(join(root, file), "utf8")).map(line => `${file}:${line}`));
	expect(problems).toEqual([]);
});
