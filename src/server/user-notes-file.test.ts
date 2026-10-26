import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { UserNotesFile } from "./user-notes-file";

const dirs: string[] = [];
afterEach(() => {
	flushJsonFiles();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function notesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-notes-"));
	dirs.push(dir);
	return join(dir, "notes.json");
}

const AT = "2026-10-05T09:00:00.000Z";

test("another server loads a note's saved content, author, todo link, and project", () => {
	const path = notesPath();
	const file = new UserNotesFile(path);
	file.apply({ op: "add", note: { id: "n1", title: "Findings", body: "First", todoId: "t1", projectId: "p1", addedBy: "s1", createdAt: AT, updatedAt: AT } });
	file.apply({ op: "append", id: "n1", text: "**Next**", at: "2026-10-06T09:00:00.000Z" });
	expect(new UserNotesFile(path).value).toEqual({ notes: [{ id: "n1", title: "Findings", body: "First\n\n**Next**", todoId: "t1", projectId: "p1", addedBy: "s1", createdAt: AT, updatedAt: "2026-10-06T09:00:00.000Z" }] });
});

test("an unreadable notes file is preserved rather than overwritten", () => {
	const path = notesPath();
	writeFileSync(path, '{"notes": ["keep this"]}');
	expect(new UserNotesFile(path).value).toEqual({ notes: [] });
	expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"notes": ["keep this"]}');
});
