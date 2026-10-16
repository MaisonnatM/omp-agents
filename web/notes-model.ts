/** The notes list's pure layout: a notes directory's Markdown files as a tree of folders, flattened into rows. */
import type { ProjectNote } from "../src/shared/projects";
import { folderTree, type TreeDir } from "./changes-model";

/** One row of the notes tree: a folder, by its path from the notes, or a file; `depth` is how many folders hold it. */
export type NoteRow = { kind: "folder"; name: string; path: string; depth: number } | { kind: "file"; name: string; note: ProjectNote; depth: number };

/** `notes`, each named by its path from the notes with `/`, as the tree's rows in order: at each level folders first, then files, each by name. */
export function noteRows(notes: readonly ProjectNote[]): NoteRow[] {
	const rows: NoteRow[] = [];
	const walk = (dir: TreeDir<{ path: string; note: ProjectNote }>, depth: number): void => {
		for (const child of dir.dirs) {
			rows.push({ kind: "folder", name: child.name, path: child.path, depth });
			walk(child, depth + 1);
		}
		for (const { path, note } of dir.files) rows.push({ kind: "file", name: path.slice(path.lastIndexOf("/") + 1), note, depth });
	};
	walk(folderTree(notes.map(note => ({ path: note.name, note }))), 0);
	return rows;
}
