/** The Notes page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { ReducerFile } from "../fs";
import { applyUserNote } from "../user-notes";
import { parseUserNoteList } from "../user-notes-parse";
import type { UserNoteChange, UserNoteList } from "../user-notes-shared";

export class UserNotesFile extends ReducerFile<UserNoteList, [UserNoteChange]> {
	constructor(path: string) {
		super(path, { parse: parseUserNoteList, holds: "a note list", empty: { notes: [] }, reduce: applyUserNote });
	}
}
