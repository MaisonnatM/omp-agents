import { expect, test } from "bun:test";
import type { UserNote } from "../src/user-notes-shared";
import { notesIn } from "./notes-views";

const AT = "2026-11-09T09:00:00.000Z";
const note = (id: string, fields: Partial<UserNote> = {}): UserNote => ({ id, title: id, body: "", todoId: null, addedBy: null, space: "work", createdAt: AT, updatedAt: AT, ...fields });

test("each list holds only the notes of the space on screen", () => {
	const list = { notes: [note("work-mine"), note("personal-mine", { space: "personal" }), note("personal-agent", { space: "personal", addedBy: "s1" }), note("work-agent", { addedBy: "s2" })] };
	const ids = (notes: readonly UserNote[]) => notes.map(entry => entry.id);
	expect(ids(notesIn(list, { kind: "all" }, "personal"))).toEqual(["personal-mine", "personal-agent"]);
	expect(ids(notesIn(list, { kind: "agents" }, "personal"))).toEqual(["personal-agent"]);
	expect(ids(notesIn(list, { kind: "all" }, "work"))).toEqual(["work-mine", "work-agent"]);
	expect(ids(notesIn(list, { kind: "agents" }, "work"))).toEqual(["work-agent"]);
});
