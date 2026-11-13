import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserNoteChange } from "../user-notes-shared";
import { NoteInbox } from "./note-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "note-inbox"));
	return join(dir, "note-inbox");
}

const AT = "2026-10-05T09:00:00.000Z";
const note = (addedBy: string | null) => ({ id: "a", title: "Findings", body: "", todoId: null, addedBy, createdAt: AT, updatedAt: AT });

describe("NoteInbox", () => {
	test("applies an agent's adds and appends, oldest first, and sets aside an edit, a removal, an add in no session's name, or a file that is not a change", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "append", id: "a", text: "More", at: AT }));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add", note: note("s1") }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "remove", id: "mine" }));
		writeFileSync(join(dir, "4-x.json"), "{not json");
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ op: "edit-body", id: "mine", body: "", at: AT }));
		writeFileSync(join(dir, "6-x.tmp"), JSON.stringify({ op: "add", note: note("s1") }));
		writeFileSync(join(dir, "7-x.json"), JSON.stringify({ op: "add", note: note(null) }));
		const applied: UserNoteChange[] = [];
		await new NoteInbox(dir, change => applied.push(change)).drain();
		expect(applied).toEqual([
			{ op: "add", note: note("s1") },
			{ op: "append", id: "a", text: "More", at: AT },
		]);
		expect(readdirSync(dir).sort()).toEqual(["3-x.json.invalid", "4-x.json.invalid", "5-x.json.invalid", "6-x.tmp", "7-x.json.invalid"]);
	});

	test("a server that does not own the unattended work leaves the changes for the one that does", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add", note: note("s1") }));
		let owns = false;
		const applied: UserNoteChange[] = [];
		const inbox = new NoteInbox(dir, change => applied.push(change), { active: () => owns });
		await inbox.drain();
		expect(readdirSync(dir)).toEqual(["1-x.json"]);
		owns = true;
		await inbox.drain();
		expect(applied).toHaveLength(1);
		expect(readdirSync(dir)).toEqual([]);
	});
});
