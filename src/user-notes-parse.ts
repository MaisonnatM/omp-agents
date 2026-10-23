/** Reading the Notes page's list and its changes from untyped JSON: `notes.json`, the page's `user-note` messages, and the files omp's `user_note` tool leaves. */
import { isObject } from "./json";
import type { UserNote, UserNoteChange, UserNoteList } from "./user-notes-shared";
import { isTodoId } from "./user-todos-parse";

/** The longest note title and body the server takes in a change. */
export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_BODY = 100_000;

const isString = (value: unknown): value is string => typeof value === "string";
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptionalId = (value: unknown): value is string | null => value === null || isTodoId(value);
const isTitle = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_NOTE_TITLE;
const isBody = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_NOTE_BODY;

/** What a note's strings must be. The file takes any it holds; a change from a page or an agent is held to the limits. */
interface Fields {
	id: (value: unknown) => value is string;
	title: (value: unknown) => value is string;
	body: (value: unknown) => value is string;
}

const STORED: Fields = { id: isString, title: isString, body: isString };
const SENT: Fields = { id: isTodoId, title: isTitle, body: isBody };

/** A note; one with no body, todo, author, or update time reads as having none, updated when it was added. */
function parseNote(value: unknown, fields: Fields): UserNote | null {
	if (!isObject(value)) return null;
	const { id, title, body = "", todoId = null, addedBy = null, createdAt, updatedAt = createdAt } = value;
	if (!fields.id(id) || !fields.title(title) || !fields.body(body) || !isOptionalId(todoId) || !isOptionalId(addedBy)) return null;
	return isTime(createdAt) && isTime(updatedAt) ? { id, title, body, todoId, addedBy, createdAt, updatedAt } : null;
}

/** The list `notes.json` holds, the most recently updated first, `null` when it holds none. */
export function parseUserNoteList(value: unknown): UserNoteList | null {
	if (!isObject(value) || !Array.isArray(value.notes)) return null;
	const notes: UserNote[] = [];
	for (const raw of value.notes) {
		const note = parseNote(raw, STORED);
		if (!note) return null;
		notes.push(note);
	}
	return { notes: notes.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) };
}

/** One change to the list, from a page or an agent, each string within its limit; `null` for anything else. */
export function parseNoteChange(value: unknown): UserNoteChange | null {
	if (!isObject(value)) return null;
	const { op, id, at } = value;
	if (op === "add") {
		const note = parseNote(value.note, SENT);
		return note && { op, note };
	}
	if (op === "restore") {
		const { index } = value;
		const note = parseNote(value.note, SENT);
		return note && typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? { op, note, index } : null;
	}
	if (!isTodoId(id)) return null;
	switch (op) {
		case "edit-title":
			return isTitle(value.title) && isTime(at) ? { op, id, title: value.title, at } : null;
		case "edit-body":
			return isBody(value.body) && isTime(at) ? { op, id, body: value.body, at } : null;
		case "append":
			return isBody(value.text) && isTime(at) ? { op, id, text: value.text, at } : null;
		case "set-todo":
			return isOptionalId(value.todoId) ? { op, id, todoId: value.todoId } : null;
		case "remove":
			return { op, id };
		default:
			return null;
	}
}
