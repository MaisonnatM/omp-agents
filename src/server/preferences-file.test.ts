import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flushJsonFiles } from "../fs";
import { PreferencesFile } from "./preferences-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function preferencesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-preferences-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "preferences.json");
}

describe("PreferencesFile", () => {
	test("holds none until a page seeds them, then saves each change as { values } for the next server", () => {
		const path = preferencesPath();
		const first = new PreferencesFile(path);
		expect(first.value).toBeNull();
		expect(first.apply({ op: "seed", values: { "omp-agents.theme": "dark" } })).toBe(true);
		expect(first.apply({ op: "seed", values: { "omp-agents.theme": "light" } })).toBe(false);
		expect(first.apply({ op: "set", key: "omp-agents.hide-tool-calls", value: "true" })).toBe(true);
		flushJsonFiles();
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ values: { "omp-agents.theme": "dark", "omp-agents.hide-tool-calls": "true" } });
		expect(new PreferencesFile(path).value).toEqual({ "omp-agents.theme": "dark", "omp-agents.hide-tool-calls": "true" });
	});

	test("a file that holds a key this version does not carry moves aside, so the next page seeds again", () => {
		const path = preferencesPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ values: { "omp-agents.split-columns": "0.4" } }));
		expect(new PreferencesFile(path).value).toBeNull();
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});
