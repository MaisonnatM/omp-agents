import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNotes, moveOldNotes, seedNotes, seedUserNotes, writeInboxEvent } from "./project-notes";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-notes-"));
	dirs.push(root);
	return root;
}

const names = async (dir: string) => (await listNotes(dir)).map(note => note.name);

describe("project notes", () => {
	test("seeding writes notes.md with the goal, Decisions, the index, and Promoted, then the other notes in their folders, and keeps a file already there", async () => {
		const dir = join(tempDir(), "p1");
		seedNotes(dir, "Billing", "Migrate billing to v3.\n");
		writeFileSync(join(dir, "docs", "testing.md"), "Run bun test.\n");
		seedNotes(dir, "Billing", "Other goal");
		const notes = readFileSync(join(dir, "notes.md"), "utf8");
		expect(notes).toStartWith("# Billing\n\n## Goal\n\nMigrate billing to v3.\n\n## Decisions\n");
		for (const link of ["docs/testing.md", "docs/research.md", "internal/checklist.md", "archived.md"]) expect(notes).toContain(`- [${link}](${link})`);
		expect(notes).toContain("`inbox/`");
		expect(notes).toContain("## Promoted");
		expect(readFileSync(join(dir, "docs", "testing.md"), "utf8")).toBe("Run bun test.\n");
		expect(await names(dir)).toEqual(["archived.md", "docs/research.md", "docs/testing.md", "internal/checklist.md", "notes.md"]);
	});

	test("an older project's notes move to their places, only where the place is free, and nothing is deleted", async () => {
		const dir = tempDir();
		for (const name of ["README.md", "testing.md", "research.md", "preferences.md", "checklist.md", "worker-prompts.md"]) writeFileSync(join(dir, name), `old ${name}\n`);
		mkdirSync(join(dir, "docs"));
		writeFileSync(join(dir, "docs", "research.md"), "new research\n");
		moveOldNotes(dir);
		expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("old README.md\n");
		expect(readFileSync(join(dir, "docs", "testing.md"), "utf8")).toBe("old testing.md\n");
		expect(readFileSync(join(dir, "docs", "preferences.md"), "utf8")).toBe("old preferences.md\n");
		expect(readFileSync(join(dir, "internal", "checklist.md"), "utf8")).toBe("old checklist.md\n");
		expect(readFileSync(join(dir, "docs", "research.md"), "utf8")).toBe("new research\n");
		expect(readFileSync(join(dir, "research.md"), "utf8")).toBe("old research.md\n");
		expect(await names(dir)).toEqual(["docs/preferences.md", "docs/research.md", "docs/testing.md", "internal/checklist.md", "notes.md", "research.md", "worker-prompts.md"]);
		seedNotes(dir, "Billing", "Ignored goal");
		expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("old README.md\n");
		expect(existsSync(join(dir, "archived.md"))).toBe(true);
	});

	test("an outside event becomes an inbox file named by its time, source, and title, with its source, time, link, and text", () => {
		const dir = tempDir();
		const event = { source: "GitHub", title: "Checks failed on #12", text: "lint\n", url: "https://github.com/o/r/pull/12" };
		const path = writeInboxEvent(dir, event, "2026-10-16T09:05:00.000Z");
		expect(path).toBe(join(dir, "inbox", "2026-10-16T09-05-00Z-github-checks-failed-on-12.md"));
		expect(readFileSync(path, "utf8")).toBe("# Checks failed on #12\n\n- Source: GitHub\n- Time: 2026-10-16T09:05:00.000Z\n- URL: https://github.com/o/r/pull/12\n\nlint\n");
		const again = writeInboxEvent(dir, { ...event, url: null, text: "lint again" }, "2026-10-16T09:05:00.000Z");
		expect(again).toBe(join(dir, "inbox", "2026-10-16T09-05-00Z-github-checks-failed-on-12-2.md"));
		expect(readFileSync(again, "utf8")).not.toContain("URL");
		expect(readFileSync(path, "utf8")).toContain("lint\n");
	});

	test("the user's notes start with preferences.md and workflows/README.md, and a file already there stays", async () => {
		const dir = join(tempDir(), "user");
		mkdirSync(dir);
		writeFileSync(join(dir, "preferences.md"), "Short answers.\n");
		seedUserNotes(dir);
		seedUserNotes(dir);
		expect(readFileSync(join(dir, "preferences.md"), "utf8")).toBe("Short answers.\n");
		expect(readFileSync(join(dir, "workflows", "README.md"), "utf8")).toStartWith("# Workflows\n");
		expect(await names(dir)).toEqual(["preferences.md", "workflows/README.md"]);
	});

	test("the list holds Markdown files at any depth, by path, without hidden ones, other files, or a linked folder", async () => {
		const dir = tempDir();
		mkdirSync(join(dir, "inbox", "old"), { recursive: true });
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, "notes.md"), "");
		writeFileSync(join(dir, "inbox", "b.md"), "");
		writeFileSync(join(dir, "inbox", "old", "a.md"), "");
		writeFileSync(join(dir, "inbox", "scratch.txt"), "");
		writeFileSync(join(dir, ".git", "HEAD.md"), "");
		symlinkSync(dir, join(dir, "loop"));
		const notes = await listNotes(dir);
		expect(notes.map(note => note.name)).toEqual(["inbox/b.md", "inbox/old/a.md", "notes.md"]);
		expect(notes[1]?.path).toBe(join(dir, "inbox", "old", "a.md"));
		expect(await listNotes(join(dir, "missing"))).toEqual([]);
	});
});
