/** The notes list's pure layout: a notes directory's Markdown files as a tree of folders, flattened into rows. */
import type { ProjectNote } from "../src/shared/projects";

/** One row of the notes tree: a folder, by its path from the notes, or a file; `depth` is how many folders hold it. */
export type NoteRow = { kind: "folder"; name: string; path: string; depth: number } | { kind: "file"; name: string; note: ProjectNote; depth: number };

interface Folder {
	folders: Map<string, Folder>;
	files: { name: string; note: ProjectNote }[];
}

/** `notes`, each named by its path from the notes with `/`, as the tree's rows in order: at each level folders first, then files, each by name. */
export function noteRows(notes: readonly ProjectNote[]): NoteRow[] {
	const root: Folder = { folders: new Map(), files: [] };
	for (const note of notes) {
		const parts = note.name.split("/").filter(Boolean);
		const name = parts.pop();
		if (!name) continue;
		let folder = root;
		for (const part of parts) {
			let next = folder.folders.get(part);
			if (!next) {
				next = { folders: new Map(), files: [] };
				folder.folders.set(part, next);
			}
			folder = next;
		}
		folder.files.push({ name, note });
	}
	const rows: NoteRow[] = [];
	const walk = (folder: Folder, prefix: string, depth: number): void => {
		for (const [name, child] of [...folder.folders].sort(([a], [b]) => a.localeCompare(b))) {
			const path = prefix ? `${prefix}/${name}` : name;
			rows.push({ kind: "folder", name, path, depth });
			walk(child, path, depth + 1);
		}
		for (const file of folder.files.toSorted((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: "file", ...file, depth });
	};
	walk(root, "", 0);
	return rows;
}
