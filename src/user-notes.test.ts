import { describe, expect, test } from "bun:test";
import { addNote, applyUserNote } from "./user-notes";
import { MAX_NOTE_TITLE, parseNoteChange, parseUserNoteList } from "./user-notes-parse";
import type { UserNote, UserNoteChange, UserNoteList } from "./user-notes-shared";

const CREATED = "2026-10-01T08:00:00.000Z";
const AT = "2026-10-05T09:00:00.000Z";

const note = (id: string, fields: Partial<UserNote> = {}): UserNote => ({ id, title: id, body: "", todoId: null, addedBy: null, createdAt: CREATED, updatedAt: CREATED, ...fields });
const listOf = (...notes: UserNote[]): UserNoteList => ({ notes });
const after = (list: UserNoteList, ...changes: UserNoteChange[]): UserNoteList => changes.reduce(applyUserNote, list);
const ids = ({ notes }: UserNoteList): string => notes.map(entry => entry.id).join(" ");

describe("applyUserNote", () => {
	test("adds a note first, once", () => {
		const added = note("c");
		expect(ids(after(listOf(note("a"), note("b")), { op: "add", note: added }, { op: "add", note: { ...added, title: "other" } }))).toBe("c a b");
	});

	test("an edit moves the note first and marks when it changed", () => {
		const list = after(listOf(note("a"), note("b")), { op: "edit-title", id: "b", title: "Plan", at: AT });
		expect(ids(list)).toBe("b a");
		expect(list.notes[0]).toMatchObject({ title: "Plan", updatedAt: AT });
	});

	test("changes nothing for the same text, an empty append, or an unknown note", () => {
		const list = listOf(note("a", { body: "x" }));
		for (const change of [
			{ op: "edit-title", id: "a", title: "a", at: AT },
			{ op: "edit-body", id: "a", body: "x", at: AT },
			{ op: "append", id: "a", text: "", at: AT },
			{ op: "set-todo", id: "a", todoId: null },
			{ op: "edit-body", id: "gone", body: "y", at: AT },
			{ op: "remove", id: "gone" },
		] satisfies UserNoteChange[]) {
			expect(applyUserNote(list, change)).toBe(list);
		}
	});

	test("an append adds a paragraph, or becomes the body of an empty note", () => {
		const list = after(listOf(note("a", { body: "first" }), note("b")), { op: "append", id: "a", text: "second", at: AT }, { op: "append", id: "b", text: "only", at: AT });
		expect(list.notes.map(entry => entry.body)).toEqual(["only", "first\n\nsecond"]);
	});

	test("linking a todo keeps the note's place and update time", () => {
		const list = after(listOf(note("a"), note("b")), { op: "set-todo", id: "b", todoId: "t1" });
		expect(ids(list)).toBe("a b");
		expect(list.notes[1]).toMatchObject({ todoId: "t1", updatedAt: CREATED });
	});

	test("a restore puts a removed note back where it was", () => {
		const list = listOf(note("a"), note("b"), note("c"));
		const removed = after(list, { op: "remove", id: "b" });
		expect(ids(removed)).toBe("a c");
		expect(after(removed, { op: "restore", note: note("b"), index: 1 })).toEqual(list);
	});

	test("a new note is untitled and empty unless given more", () => {
		expect(addNote({ todoId: "t1" }).note).toMatchObject({ title: "", body: "", todoId: "t1", addedBy: null });
	});
});

describe("parseUserNoteList", () => {
	test("reads a note with only an id, a title, and an added time, most recently updated first", () => {
		const list = parseUserNoteList({ notes: [{ id: "a", title: "A", createdAt: CREATED }, note("b", { updatedAt: AT })] });
		expect(list?.notes).toEqual([note("b", { updatedAt: AT }), note("a", { title: "A" })]);
	});

	test("holds none for a note it cannot read", () => {
		expect(parseUserNoteList({ notes: [{ id: "a", title: "A" }] })).toBeNull();
		expect(parseUserNoteList({ todos: [] })).toBeNull();
	});
});

describe("parseNoteChange", () => {
	test("takes each change within its limits", () => {
		const changes: UserNoteChange[] = [
			{ op: "add", note: note("a") },
			{ op: "edit-title", id: "a", title: "T", at: AT },
			{ op: "edit-body", id: "a", body: "B", at: AT },
			{ op: "append", id: "a", text: "more", at: AT },
			{ op: "set-todo", id: "a", todoId: "t1" },
			{ op: "remove", id: "a" },
			{ op: "restore", note: note("a"), index: 2 },
		];
		for (const change of changes) expect(parseNoteChange(change)).toEqual(change);
	});

	test("refuses a title too long, a blank id, a bad time, or an unknown op", () => {
		expect(parseNoteChange({ op: "edit-title", id: "a", title: "x".repeat(MAX_NOTE_TITLE + 1), at: AT })).toBeNull();
		expect(parseNoteChange({ op: "add", note: note(" ") })).toBeNull();
		expect(parseNoteChange({ op: "append", id: "a", text: "x", at: "later" })).toBeNull();
		expect(parseNoteChange({ op: "toggle", id: "a" })).toBeNull();
	});
});
