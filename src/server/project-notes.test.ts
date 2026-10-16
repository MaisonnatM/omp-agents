import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNotes, seedNotes } from "./project-notes";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("project notes", () => {
	test("seeding writes the README with the goal, the four notes, and a Promoted section, keeps a file already there, and lists README first", async () => {
		const root = mkdtempSync(join(tmpdir(), "omp-agents-notes-"));
		dirs.push(root);
		const dir = join(root, "p1");
		seedNotes(dir, "Billing", "Migrate billing to v3.\n");
		writeFileSync(join(dir, "testing.md"), "Run bun test.\n");
		seedNotes(dir, "Billing", "Other goal");
		const readme = readFileSync(join(dir, "README.md"), "utf8");
		expect(readme).toContain("# Billing\n\n## Goal\n\nMigrate billing to v3.\n");
		expect(readme).toContain("- [checklist.md](checklist.md)");
		expect(readme).toContain("## Promoted");
		expect(readFileSync(join(dir, "testing.md"), "utf8")).toBe("Run bun test.\n");
		writeFileSync(join(dir, "scratch.txt"), "not a note");
		expect((await listNotes(dir)).map(note => note.name)).toEqual(["README.md", "checklist.md", "preferences.md", "research.md", "testing.md"]);
		expect(await listNotes(join(root, "missing"))).toEqual([]);
	});
});
