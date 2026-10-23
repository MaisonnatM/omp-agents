/** The changes explorer's pure layout: the tree, the diff's folds, the file view's gutter marks, and the changes card's paths. */
import type { ChangedEntry, DiffRow } from "../src/shared/changes";
import { absoluteFilePath } from "./file-paths";

/** A folder of files, each keyed by its `path` from the root with `/`; a changed file unless `T` says otherwise. */
export interface TreeDir<T extends { path: string } = ChangedEntry> {
	/** Its name in its parent, which in the changes explorer joins a chain of single-directory folders: `src/server`. */
	name: string;
	/** Its path from the root, which keys its open state. */
	path: string;
	dirs: TreeDir<T>[];
	files: T[];
}

/**
 * The files as folders, directories first and each level by name, which the changes explorer and the notes list share.
 * An absolute path, a file the session changed outside its checkout, hangs under a `/` folder.
 */
export function folderTree<T extends { path: string }>(files: readonly T[]): TreeDir<T> {
	type Building = { name: string; path: string; dirs: Map<string, Building>; files: T[] };
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
	const settle = (node: Building): TreeDir<T> => ({
		name: node.name,
		path: node.path,
		dirs: [...node.dirs.values()].map(settle).sort((a, b) => a.name.localeCompare(b.name)),
		files: node.files.toSorted((a, b) => a.path.localeCompare(b.path)),
	});
	return settle(root);
}

/** The changes explorer's tree: {@link folderTree}, where a folder holding one folder and no file joins it. */
export function fileTree(files: readonly ChangedEntry[]): TreeDir {
	const joined = (dir: TreeDir): TreeDir => {
		const dirs = dir.dirs.map(joined).sort((a, b) => a.name.localeCompare(b.name));
		const only = dirs[0];
		if (dir.name && dir.files.length === 0 && dirs.length === 1 && only) return { ...only, name: `${dir.name === "/" ? "" : dir.name}/${only.name}` };
		return { ...dir, dirs };
	};
	return joined(folderTree(files));
}

/** The files in the explorer's order, which ↓ and ↑ walk. */
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

/** A file changing more lines than this waits for a click before its diff reads, as GitHub's large diffs do. */
export const CLICK_TO_LOAD_LINES = 2000;

/** Lines added and removed; a binary file, which git does not count, changes none. */
export const changedLines = (file: ChangedEntry): number => (file.added ?? 0) + (file.removed ?? 0);

/** Rows a file's diff shows before it is read: its changed lines, a fold, and the context around them. */
export const estimatedRows = (file: ChangedEntry): number => changedLines(file) + 2 * DIFF_CONTEXT;

/** The last of `count` items laid out top to bottom whose `top(index)` is at or above `y`, by binary search; 0 when none is. */
export function lastAtOrAbove(count: number, top: (index: number) => number, y: number): number {
	let low = 0;
	let high = count - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (top(middle) <= y) low = middle;
		else high = middle - 1;
	}
	return low;
}

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

/** A run of the diff by row index: an unchanged row, or the rows one change removed and added; `start` is its first row. */
export type ChangeBlock = { kind: "same"; start: number } | { kind: "change"; start: number; removed: number[]; added: number[] };

/** The diff's rows as blocks, in order, each row in exactly one. */
export function changeBlocks(rows: readonly DiffRow[]): ChangeBlock[] {
	const blocks: ChangeBlock[] = [];
	let index = 0;
	while (index < rows.length) {
		if (rows[index]!.sign === " ") {
			blocks.push({ kind: "same", start: index++ });
			continue;
		}
		const block: ChangeBlock = { kind: "change", start: index, removed: [], added: [] };
		for (; index < rows.length && rows[index]!.sign !== " "; index++) (rows[index]!.sign === "-" ? block.removed : block.added).push(index);
		blocks.push(block);
	}
	return blocks;
}

/** `set` with `path` in it or out of it as `member` says; `set` itself when it already is. */
export function withMember(set: ReadonlySet<string>, path: string, member: boolean): ReadonlySet<string> {
	if (set.has(path) === member) return set;
	const next = new Set(set);
	if (member) next.add(path);
	else next.delete(path);
	return next;
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

/**
 * The path the session's changes list gives the file that the changes card names `path`, relative to the session's `cwd` or
 * absolute with `~`; `null` when the list holds no such file. A `~` path inside the checkout matches by its tail.
 */
export function changesPathOf(path: string, cwd: string | null, root: string | null, files: readonly ChangedEntry[]): string | null {
	const has = (candidate: string): boolean => files.some(file => file.path === candidate);
	const absolute = absoluteFilePath(path, cwd);
	if (root !== null && absolute?.startsWith(`${root}/`) && has(absolute.slice(root.length + 1))) return absolute.slice(root.length + 1);
	if (has(path)) return path;
	const tails = files.filter(file => path.endsWith(`/${file.path}`));
	return tails.reduce<string | null>((best, file) => (best === null || file.path.length > best.length ? file.path : best), null);
}

/**
 * Each path's file name, and the fewest folders above it that tell it from another path of the same name, as `web/`
 * for `web/app.tsx` beside `src/app.tsx`; the folders are `""` for a name no other path shares.
 */
export function shortPaths(paths: readonly string[]): { name: string; dir: string }[] {
	const split = paths.map(path => {
		const parts = path.split("/");
		return { name: parts.at(-1)!, folders: parts.slice(0, -1) };
	});
	const tail = (folders: string[], count: number): string => folders.slice(-count).join("/");
	return split.map(({ name, folders }, at) => {
		const twins = split.filter((other, index) => index !== at && other.name === name);
		if (twins.length === 0 || folders.length === 0) return { name, dir: "" };
		let count = 1;
		while (count < folders.length && twins.some(twin => tail(twin.folders, count) === tail(folders, count))) count++;
		return { name, dir: `${tail(folders, count)}/` };
	});
}
