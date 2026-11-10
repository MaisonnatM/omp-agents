import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncPstackSkills } from "./agent/extensions/pstack-skills/sync";

const root = mkdtempSync(join(tmpdir(), "pstack-skills-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A plugins directory holding one unpacked pstack `version` with `skills`, registered as omp's installer registers it. */
function install(pluginsDir: string, version: string, skills: string[]): string {
	const installPath = join(pluginsDir, "cache", "plugins", `cursor-plugins___pstack___${version}`);
	for (const name of skills) {
		mkdirSync(join(installPath, "skills", name), { recursive: true });
		writeFileSync(join(installPath, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\ndisable-model-invocation: true\n---\n`);
	}
	const registry = { version: 2, plugins: { "pstack@cursor-plugins": [{ scope: "user", installPath, version }] } };
	writeFileSync(join(pluginsDir, "installed_plugins.json"), JSON.stringify(registry));
	return join(installPath, "skills");
}

describe("syncPstackSkills", () => {
	test("links every pstack skill but the kit's poteto-mode alias, and follows an update", () => {
		const pluginsDir = join(root, "update");
		const v1 = install(pluginsDir, "0.15.36", ["arena", "how", "poteto-mode", "retired"]);
		expect(syncPstackSkills(pluginsDir)).toBe(v1);
		const links = join(pluginsDir, "pstack-skills");
		expect(readdirSync(links).sort()).toEqual(["arena", "how", "retired"]);
		expect(readlinkSync(join(links, "arena"))).toBe(join(v1, "arena"));

		const v2 = install(pluginsDir, "0.16.0", ["arena", "how", "poteto-mode", "sharpen"]);
		expect(syncPstackSkills(pluginsDir)).toBe(v2);
		expect(readdirSync(links).sort()).toEqual(["arena", "how", "sharpen"]);
		for (const name of ["arena", "how", "sharpen"]) expect(readlinkSync(join(links, name))).toBe(join(v2, name));
	});

	test("leaves a skill directory that is not a link alone", () => {
		const pluginsDir = join(root, "own");
		install(pluginsDir, "0.15.36", ["arena", "how"]);
		const own = join(pluginsDir, "pstack-skills", "how");
		mkdirSync(own, { recursive: true });
		syncPstackSkills(pluginsDir);
		expect(lstatSync(own).isDirectory()).toBe(true);
		expect(lstatSync(join(pluginsDir, "pstack-skills", "arena")).isSymbolicLink()).toBe(true);
	});

	test("does nothing without pstack installed", () => {
		const pluginsDir = join(root, "none");
		mkdirSync(pluginsDir, { recursive: true });
		writeFileSync(join(pluginsDir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {} }));
		expect(syncPstackSkills(pluginsDir)).toBeUndefined();
		expect(existsSync(join(pluginsDir, "pstack-skills"))).toBe(false);
	});
});
