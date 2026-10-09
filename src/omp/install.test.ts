import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest } from "./install";

const dir = mkdtempSync(join(tmpdir(), "omp-agents-manifest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a manifest reads as its JSON object, fresh from disk", () => {
	const path = join(dir, "package.json");
	writeFileSync(path, JSON.stringify({ name: "pkg", version: "1.0.0" }));
	expect(readManifest(path)).toEqual({ name: "pkg", version: "1.0.0" });
	writeFileSync(path, JSON.stringify({ name: "pkg", version: "1.1.0" }));
	expect(readManifest(path).version).toBe("1.1.0");
});

test("a malformed, non-object, or missing manifest throws naming its path", () => {
	const malformed = join(dir, "malformed.json");
	writeFileSync(malformed, "{ name: ");
	expect(() => readManifest(malformed)).toThrow(`could not read the package manifest ${malformed}`);
	const text = join(dir, "text.json");
	writeFileSync(text, JSON.stringify("pkg"));
	expect(() => readManifest(text)).toThrow(`${text} is not a package manifest`);
	expect(() => readManifest(join(dir, "missing.json"))).toThrow("could not read the package manifest");
});
