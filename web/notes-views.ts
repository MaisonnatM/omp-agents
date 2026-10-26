/** The Notes page's lists: what each shows, its name and icon in the sidebar, and what it says while empty. */
import { Bot, type LucideIcon, NotebookPen } from "lucide-react";
import type { UserNote, UserNoteList } from "../src/user-notes-shared";
import type { NotesListView } from "./routing";

export const NOTES_LISTS: { view: NotesListView; name: string; icon: LucideIcon; empty: string }[] = [
	{ view: { kind: "all" }, name: "All", icon: NotebookPen, empty: "No notes yet. Press C to write one." },
	{ view: { kind: "agents" }, name: "From agents", icon: Bot, empty: "No agent has added a note. An omp session adds one with its `user_note` tool." },
];

/** The notes `view` lists, most recently updated first. */
export function notesIn({ notes }: UserNoteList, view: NotesListView): readonly UserNote[] {
	switch (view.kind) {
		case "all":
			return notes;
		case "agents":
			return notes.filter(note => note.addedBy !== null);
	}
}

/** What the Notes page calls `view` and says while it lists nothing. */
export function notesListText(view: NotesListView): { name: string; empty: string } {
	return NOTES_LISTS.find(row => row.view.kind === view.kind)!;
}
