import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkedPstackSkills } from "./readiness";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** omp's plugins directory with its registry path, and pstack's skills in the plugin cache. */
function plugins(): { registry: string; links: string; skill: (name: string, withSkillFile?: boolean) => string } {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-readiness-"));
	dirs.push(root);
	const skill = (name: string, withSkillFile = true): string => {
		const dir = join(root, "cache", "pstack", name);
		mkdirSync(dir, { recursive: true });
		if (withSkillFile) writeFileSync(join(dir, "SKILL.md"), `# ${name}\n`);
		return dir;
	};
	return { registry: join(root, "installed_plugins.json"), links: join(root, "pstack-skills"), skill };
}

test("no pstack-skills directory beside the registry counts no skills", () => {
	expect(linkedPstackSkills(plugins().registry)).toBe(0);
});

test("only links whose skill still has its SKILL.md count", () => {
	const { registry, links, skill } = plugins();
	mkdirSync(links);
	symlinkSync(skill("arena"), join(links, "arena"));
	symlinkSync(skill("technical-writing"), join(links, "technical-writing"));
	symlinkSync(skill("gone", false), join(links, "gone"));
	symlinkSync(join(links, "..", "cache", "pstack", "never-existed"), join(links, "dangling"));
	mkdirSync(join(links, "copied"));
	writeFileSync(join(links, "copied", "SKILL.md"), "# copied\n");
	expect(linkedPstackSkills(registry)).toBe(2);
});
