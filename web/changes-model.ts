/** The changes page's pure layout: the explorer's tree, the diff's folds, and the file view's gutter marks. */
import type { ChangedEntry, DiffRow } from "../src/shared/changes";

export interface TreeDir {
	/** Its name in its parent, which joins a chain of single-directory folders: `src/server`. */
	name: string;
	/** Its path from the root, which keys its open state. */
	path: string;
	dirs: TreeDir[];
	files: ChangedEntry[];
}

/**
 * The files as folders, directories first and each level by name; a folder holding one folder and no file joins it.
 * An absolute path, a file the session changed outside its checkout, hangs under a `/` folder.
 */
export function fileTree(files: readonly ChangedEntry[]): TreeDir {
	type Building = { name: string; path: string; dirs: Map<string, Building>; files: ChangedEntry[] };
	const root: Building = { name: "", path: "", dirs: new Map(), files: [] };
	for (const file of files) {
		let node = root;
		const parts = file.path.split("/").slice(0, -1);
		if (parts[0] === "") parts[0] = "/";
		for (const part of parts) {
			let next = node.dirs.get(part);
			if (!next) {
				next = { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] };
				node.dirs.set(part, next);
			}
			node = next;
		}
		node.files.push(file);
	}
	const settle = (node: Building): TreeDir => {
		const dirs = [...node.dirs.values()].map(settle).sort((a, b) => a.name.localeCompare(b.name));
		const files = node.files.toSorted((a, b) => a.path.localeCompare(b.path));
		const only = dirs[0];
		if (node.name && files.length === 0 && dirs.length === 1 && only) return { ...only, name: `${node.name === "/" ? "" : node.name}/${only.name}` };
		return { name: node.name, path: node.path, dirs, files };
	};
	return settle(root);
}

/** The files in the explorer's order, which J and K walk. */
export const treeOrder = (dir: TreeDir): ChangedEntry[] => [...dir.dirs.flatMap(treeOrder), ...dir.files];

/** The paths of the folders that hold `path`, outermost first, which must be open for its row to show; `null` when no folder holds it. */
export function foldersAbove(dir: TreeDir, path: string): string[] | null {
	if (dir.files.some(file => file.path === path)) return [];
	for (const child of dir.dirs) {
		const above = foldersAbove(child, path);
		if (above) return [child.path, ...above];
	}
	return null;
}

/** Unchanged lines the diff keeps on each side of a change. */
export const DIFF_CONTEXT = 3;

/** A diff row on screen, or a fold of `to - from` unchanged rows that `start` names once unfolded. */
export type DiffItem = { kind: "row"; index: number } | { kind: "fold"; from: number; to: number; start: number };

/**
 * The diff with each run of unchanged rows folded but for {@link DIFF_CONTEXT} rows next to a change; the file's own start
 * and end keep none. A fold must hide more than two rows, and `opened` holds the `start` of each run unfolded. A file
 * with no change, which only the session's calls name, shows whole.
 */
export function foldDiff(rows: readonly DiffRow[], opened: ReadonlySet<number>): DiffItem[] {
	const items: DiffItem[] = [];
	const show = (from: number, to: number) => {
		for (let index = from; index < to; index++) items.push({ kind: "row", index });
	};
	let index = 0;
	while (index < rows.length) {
		if (rows[index]!.sign !== " ") {
			items.push({ kind: "row", index: index++ });
			continue;
		}
		let end = index;
		while (end < rows.length && rows[end]!.sign === " ") end++;
		const lead = index === 0 ? 0 : DIFF_CONTEXT;
		const tail = end === rows.length ? 0 : DIFF_CONTEXT;
		const whole = index === 0 && end === rows.length;
		if (!whole && end - index - lead - tail > 2 && !opened.has(index)) {
			show(index, index + lead);
			items.push({ kind: "fold", from: index + lead, to: end - tail, start: index });
			show(end - tail, end);
		} else show(index, end);
		index = end;
	}
	return items;
}

/**
 * A line of the file as it is now, with its gutter mark: `added` in a run of added rows, `modified` in one that follows
 * removed rows. `removed` holds the removed rows just before its run, which a click anywhere on the run's gutter shows
 * above `run`, the run's first line.
 */
export interface FileLine {
	index: number;
	mark: "added" | "modified" | null;
	removed: number[];
	run: number;
}

/** The file view's lines; rows removed at the very end of the file come back apart, as `removedAtEnd`. */
export function fileLines(rows: readonly DiffRow[]): { lines: FileLine[]; removedAtEnd: number[] } {
	const lines: FileLine[] = [];
	let removed: number[] = [];
	let index = 0;
	while (index < rows.length) {
		const sign = rows[index]!.sign;
		if (sign === "-") {
			removed.push(index++);
			continue;
		}
		const mark = sign === " " ? null : removed.length > 0 ? "modified" : "added";
		const run = index;
		lines.push({ index: index++, mark, removed, run });
		while (mark && index < rows.length && rows[index]!.sign === "+") lines.push({ index: index++, mark, removed, run });
		removed = [];
	}
	return { lines, removedAtEnd: removed };
}
