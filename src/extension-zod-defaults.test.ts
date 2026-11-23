import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * omp hands an extension its own zod as `pi.zod`, which refuses an object or array literal passed to `.default()` and
 * then fails to load the whole extension; a factory, `.default(() => ({ ... }))`, loads.
 */
const root = join(import.meta.dir, "..");

/** The 1-based line of each `.default(` in `source` given an object or array literal rather than a factory. */
function literalDefaults(source: string): number[] {
	return [...source.matchAll(/\.default\(\s*[[{]/g)].map(match => source.slice(0, match.index).split("\n").length);
}

test("a .default() given an object or array literal is caught", () => {
	const bad = `const params = z.object({\n\tlimits: z.object({ max: z.number() }).default({ max: 3 }),\n\ttags: z.array(z.string()).default(\n\t\t[],\n\t),\n});\n`;
	expect(literalDefaults(bad)).toEqual([2, 3]);
	expect(literalDefaults(`z.object({ max: z.number() }).default(() => ({ max: 3 })); z.number().default(3);`)).toEqual([]);
});

test("no kit extension passes an object or array literal to .default()", () => {
	const files = [...new Bun.Glob("templates/omp/**/extensions/**/*.ts").scanSync({ cwd: root })].filter(file => !file.endsWith(".test.ts")).sort();
	expect(files).toContain("templates/omp/agent/extensions/arena.ts");
	const problems = files.flatMap(file => literalDefaults(readFileSync(join(root, file), "utf8")).map(line => `${file}:${line}`));
	expect(problems).toEqual([]);
});
