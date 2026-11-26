import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RULES } from "./rules";

/**
 * A rule that stops firing fails nothing on its own: a config edit, a Biome upgrade, or a broken pattern silently drops it.
 * Each rule, Biome's and this repository's, has a canary, a file that breaks it on purpose, and each canary must still be flagged.
 */
const root = join(import.meta.dir, "../..");
const canaries = join(import.meta.dir, "canaries");

/** The rules `biome.json` turns on, as `<group>/<rule>`. */
function biomeRules(): string[] {
	const config = JSON.parse(readFileSync(join(root, "biome.json"), "utf8")) as { linter: { rules: Record<string, unknown> } };
	return Object.entries(config.linter.rules)
		.filter(([, rules]) => typeof rules === "object" && rules !== null)
		.flatMap(([group, rules]) => Object.entries(rules as Record<string, unknown>).filter(([, level]) => level !== "off").map(([rule]) => `${group}/${rule}`))
		.sort();
}

function biomeCanaries(): string[] {
	return readdirSync(join(canaries, "biome"), { recursive: true, encoding: "utf8" })
		.filter(file => file.endsWith(".ts"))
		.map(file => file.slice(0, -".ts".length))
		.sort();
}

describe("Biome canaries", () => {
	test("each rule biome.json turns on has a canary, and each canary a rule", () => {
		expect(biomeCanaries()).toEqual(biomeRules());
	});

	test("Biome flags each canary with its own rule", () => {
		const dir = mkdtempSync(join(tmpdir(), "biome-canaries-"));
		try {
			const config = JSON.parse(readFileSync(join(root, "biome.json"), "utf8")) as Record<string, unknown>;
			delete config.$schema;
			writeFileSync(join(dir, "biome.json"), JSON.stringify({ ...config, vcs: { enabled: false }, files: { includes: ["**/*.ts"] } }));
			// Every canary is copied as a test file, which the test rules need and every other rule ignores.
			for (const rule of biomeCanaries()) cpSync(join(canaries, "biome", `${rule}.ts`), join(dir, `${rule.replace("/", ".")}.test.ts`));
			const done = Bun.spawnSync([join(root, "node_modules/.bin/biome"), "lint", "--reporter=json", "--max-diagnostics=none", "."], { cwd: dir });
			const report = JSON.parse(done.stdout.toString()) as { diagnostics: { category: string; location: { path: string } }[] };
			const flagged = new Set(report.diagnostics.map(d => `${basename(d.location.path, ".test.ts").replace(".", "/")} ${d.category}`));
			const silent = biomeCanaries().filter(rule => !flagged.has(`${rule} lint/${rule}`));
			expect(silent).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("repository rule canaries", () => {
	const files = readdirSync(canaries).filter(file => file !== "biome");
	const idOf = (file: string) => file.slice(0, file.indexOf("."));

	test("each rule has one canary, and each canary a rule", () => {
		expect(files.map(idOf).sort()).toEqual(RULES.map(rule => rule.id).sort());
	});

	test.each(RULES.map(rule => [rule.id, rule] as const))("%s flags its canary", (_id, rule) => {
		const file = files.find(name => idOf(name) === rule.id);
		expect(file).toBeDefined();
		expect(rule.check(readFileSync(join(canaries, file!), "utf8"), `scripts/lint/canaries/${file}`).length).toBeGreaterThan(0);
	});
});
