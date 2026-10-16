import { describe, expect, test } from "bun:test";
import type { ProjectNote } from "../src/shared/projects";
import { noteRows } from "./notes-model";

const note = (name: string): ProjectNote => ({ name, path: `/notes/${name}`, modifiedAt: "2026-10-16T09:00:00.000Z" });
const shown = (names: string[]) => noteRows(names.map(note)).map(row => `${"  ".repeat(row.depth)}${row.kind === "folder" ? `${row.name}/` : row.name}`);

describe("noteRows", () => {
	test("lays the notes out as a tree, folders first then files at each level, each by name", () => {
		expect(shown(["notes.md", "archived.md", "internal/checklist.md", "docs/testing.md", "docs/research.md", "inbox/2026-10-16-github.md", "inbox/old/a.md"])).toEqual([
			"docs/",
			"  research.md",
			"  testing.md",
			"inbox/",
			"  old/",
			"    a.md",
			"  2026-10-16-github.md",
			"internal/",
			"  checklist.md",
			"archived.md",
			"notes.md",
		]);
	});

	test("a folder row carries its path, and a file row its note", () => {
		const rows = noteRows([note("workflows/quality/pass.md")]);
		expect(rows).toEqual([
			{ kind: "folder", name: "workflows", path: "workflows", depth: 0 },
			{ kind: "folder", name: "quality", path: "workflows/quality", depth: 1 },
			{ kind: "file", name: "pass.md", note: note("workflows/quality/pass.md"), depth: 2 },
		]);
	});

	test("no notes make no rows", () => {
		expect(noteRows([])).toEqual([]);
	});
});
