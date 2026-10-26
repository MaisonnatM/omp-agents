/** The Notes page's lists: what each shows, its name and icon in the sidebar, and what it says while empty. */
import { Bot, type LucideIcon, NotebookPen } from "lucide-react";
import type { Project } from "../src/shared/projects";
import type { UserNote, UserNoteList } from "../src/user-notes-shared";
import type { NotesListView } from "./routing";

type FixedView = Exclude<NotesListView, { kind: "project" }>;

export const NOTES_LISTS: { view: FixedView; name: string; icon: LucideIcon; empty: string }[] = [
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
		case "project":
			return notes.filter(note => note.projectId === view.id);
	}
}

/** What the Notes page calls `view` and says while it lists nothing; a project another window deleted reads Deleted project. */
export function notesListText(view: NotesListView, projects: readonly Project[]): { name: string; empty: string } {
	if (view.kind === "project") {
		const project = projects.find(row => row.id === view.id);
		return project ? { name: project.name, empty: "No note belongs to this project. Press C to write one in it." } : { name: "Deleted project", empty: "This project was deleted." };
	}
	return NOTES_LISTS.find(row => row.view.kind === view.kind)!;
}
