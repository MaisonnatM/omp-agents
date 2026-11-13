import { expect, test } from "bun:test";
import type { UserNote } from "../src/user-notes-shared";
import { notesIn } from "./notes-views";

const AT = "2026-11-09T09:00:00.000Z";
const note = (id: string, fields: Partial<UserNote> = {}): UserNote => ({ id, title: id, body: "", todoId: null, addedBy: null, createdAt: AT, updatedAt: AT, ...fields });

test("All holds every note and Agents only the ones an agent added", () => {
	const list = { notes: [note("mine"), note("agent", { addedBy: "s1" })] };
	const ids = (notes: readonly UserNote[]) => notes.map(entry => entry.id);
	expect(ids(notesIn(list, { kind: "all" }))).toEqual(["mine", "agent"]);
	expect(ids(notesIn(list, { kind: "agents" }))).toEqual(["agent"]);
});
