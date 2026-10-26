/**
 * The shapes the Notes page, the socket, and `notes.json` share.
 * The omp extension `templates/omp/agent/extensions/notes.ts` reads the same file and writes the changes it adds but cannot import `src/`, so it keeps its own copy of these shapes: change it with this one.
 */

/** A note of your own, on the Notes page. */
export interface UserNote {
	id: string;
	/** One line, `""` for none, which the page shows as Untitled. */
	title: string;
	/** Its markdown content, `""` for none. */
	body: string;
	/** The top-level todo it belongs to, `null` for none. */
	todoId: string | null;
	/** The omp session whose agent added it, `null` when you did. */
	addedBy: string | null;
	createdAt: string;
	/** When its title or body last changed, which orders the list. */
	updatedAt: string;
}

/** Every note, the most recently updated first. */
export interface UserNoteList {
	notes: UserNote[];
}

/**
 * One change to the list, from the page or an agent. A change naming a note the list lacks changes nothing, so a
 * change that crosses another window's removal is harmless.
 */
export type UserNoteChange =
	/** Adds `note` first; the list keeps the one it holds under the same id. */
	| { op: "add"; note: UserNote }
	| { op: "edit-title"; id: string; title: string; at: string }
	| { op: "edit-body"; id: string; body: string; at: string }
	/** Adds `text` as a paragraph after the body. */
	| { op: "append"; id: string; text: string; at: string }
	| { op: "set-todo"; id: string; todoId: string | null }
	| { op: "remove"; id: string }
	/** Undoes a `remove`, putting `note` back at `index`. */
	| { op: "restore"; note: UserNote; index: number };
