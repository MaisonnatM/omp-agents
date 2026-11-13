/** The rules of the Notes page's list, which the server applies to its file and the page to what it shows until the server answers. */
import type { UserNote, UserNoteChange, UserNoteList } from "./user-notes-shared";

type AddChange = Extract<UserNoteChange, { op: "add" }>;

/** The `add` of a new note, with a new id, added and updated now; whatever else `fields` leaves out is none. */
export function addNote(fields: Partial<Omit<UserNote, "id" | "createdAt" | "updatedAt">> = {}): AddChange {
	const { title = "", body = "", todoId = null, addedBy = null } = fields;
	const at = new Date().toISOString();
	return { op: "add", note: { id: crypto.randomUUID(), title, body, todoId, addedBy, createdAt: at, updatedAt: at } };
}

/** The list with the note `id` names changed by `change`, moved first when `at` marks it updated; the same list when that changes nothing. */
function update(list: UserNoteList, id: string, change: (note: UserNote) => UserNote, at: string | null): UserNoteList {
	const index = list.notes.findIndex(note => note.id === id);
	const note = list.notes[index];
	if (!note) return list;
	const changed = change(note);
	if (changed === note) return list;
	if (at === null) return { notes: list.notes.with(index, changed) };
	return { notes: [{ ...changed, updatedAt: at }, ...list.notes.toSpliced(index, 1)] };
}

/** `list` after `change`, the same object when it changes nothing. */
export function applyUserNote(list: UserNoteList, change: UserNoteChange): UserNoteList {
	switch (change.op) {
		case "add":
			return list.notes.some(note => note.id === change.note.id) ? list : { notes: [change.note, ...list.notes] };
		case "edit-title":
			return update(list, change.id, note => (note.title === change.title ? note : { ...note, title: change.title }), change.at);
		case "edit-body":
			return update(list, change.id, note => (note.body === change.body ? note : { ...note, body: change.body }), change.at);
		case "append":
			return update(list, change.id, note => (change.text === "" ? note : { ...note, body: note.body === "" ? change.text : `${note.body}\n\n${change.text}` }), change.at);
		case "set-todo":
			return update(list, change.id, note => (note.todoId === change.todoId ? note : { ...note, todoId: change.todoId }), null);
		case "remove": {
			const notes = list.notes.filter(note => note.id !== change.id);
			return notes.length === list.notes.length ? list : { notes };
		}
		case "restore":
			if (list.notes.some(note => note.id === change.note.id)) return list;
			return { notes: list.notes.toSpliced(Math.min(change.index, list.notes.length), 0, change.note) };
		default: {
			const never: never = change;
			return never;
		}
	}
}
