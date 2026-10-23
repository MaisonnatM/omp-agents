/** The Notes page's lists: what each shows, its name and icon in the sidebar, and what it says while empty. */
import { Bot, type LucideIcon, NotebookPen } from "lucide-react";
import type { UserNote, UserNoteList } from "../src/user-notes-shared";
import type { NotesListView } from "./routing";

export const NOTES_LISTS: { view: NotesListView; name: string; icon: LucideIcon; empty: string }[] = [
	{ view: { kind: "all" }, name: "All", icon: NotebookPen, empty: "No notes yet. Press C to write one." },
	{ view: { kind: "agents" }, name: "From agents", icon: Bot, empty: "No agent has added a note. An omp session adds one with its `user_note` tool." },
];

/** The notes `view` lists, most recently updated first. */
export const notesIn = ({ notes }: UserNoteList, view: NotesListView): readonly UserNote[] => (view.kind === "all" ? notes : notes.filter(note => note.addedBy !== null));
