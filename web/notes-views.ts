/** The Notes page's lists: what each shows, its name and icon in the sidebar, and what it says while empty. */
import { IconAiBotHead, IconNotebook } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type Space, spaceIs } from "../src/shared/workspaces";
import type { UserNote, UserNoteList } from "../src/user-notes-shared";
import type { NotesListView } from "./routing";

export const NOTES_LISTS: { view: NotesListView; name: string; icon: IconComponent; empty: string }[] = [
	{ view: { kind: "all" }, name: "All", icon: IconNotebook, empty: "No notes yet. Press C to write one." },
	{ view: { kind: "agents" }, name: "From agents", icon: IconAiBotHead, empty: "No agent has added a note. An omp session adds one with its `user_note` tool." },
];

/** The notes of `space` that `view` lists, most recently updated first. */
export function notesIn({ notes }: UserNoteList, view: NotesListView, space: Space): readonly UserNote[] {
	const ofSpace = notes.filter(spaceIs(space));
	switch (view.kind) {
		case "all":
			return ofSpace;
		case "agents":
			return ofSpace.filter(note => note.addedBy !== null);
		default: {
			const unhandled: never = view;
			return unhandled;
		}
	}
}

/** What the Notes page calls `view` and says while it lists nothing. */
export function notesListText(view: NotesListView): { name: string; empty: string } {
	return NOTES_LISTS.find(row => row.view.kind === view.kind)!;
}
