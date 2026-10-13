import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { directoryOf, expandHome, HOME } from "./paths";

test("expandHome reads a leading ~ or ~/ as the home directory and leaves every other path alone", () => {
	expect(expandHome("~")).toBe(HOME);
	expect(expandHome("~/")).toBe(`${HOME}/`);
	expect(expandHome("~/code/app")).toBe(join(HOME, "code", "app"));
	expect(expandHome("~/a/../b")).toBe(join(HOME, "b"));
	expect(expandHome("~other/x")).toBe("~other/x");
	expect(expandHome("code/~/x")).toBe("code/~/x");
	expect(expandHome("/srv/~")).toBe("/srv/~");
	expect(expandHome("")).toBe("");
});

test("directoryOf takes ~, ~/, and home-relative directories, and nothing that is not one", async () => {
	const dir = await mkdtemp(join(HOME, ".omp-agents-paths-test-"));
	try {
		const name = dir.slice(HOME.length + 1);
		expect(await directoryOf(" ~ ")).toBe(HOME);
		expect(await directoryOf(`~/${name}`)).toBe(dir);
		expect(await directoryOf(name)).toBe(dir);
		expect(await directoryOf(`~/${name}/missing`)).toBeNull();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
