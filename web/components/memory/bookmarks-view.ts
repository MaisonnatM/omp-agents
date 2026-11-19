/** What the Bookmarks tab reads from the bookmarks: the place its folder tree picks, Zen's folders as that tree, and the list's groups. */
import type { Bookmark, BookmarkSource } from "../../../src/shared/memory-page";

/** The folder tree's pick: every bookmark, the x.com posts, or a Zen folder with its subfolders, `[]` for all of Zen. */
export type BookmarkPlace = { kind: "all" } | { kind: "x" } | { kind: "zen"; folder: readonly string[] };

export function inPlace(place: BookmarkPlace, bookmark: Bookmark): boolean {
	if (place.kind === "all") return true;
	if (place.kind === "x") return bookmark.source === "x";
	return bookmark.source === "zen" && place.folder.every((name, at) => bookmark.folder[at] === name);
}

export function samePlace(a: BookmarkPlace, b: BookmarkPlace): boolean {
	if (a.kind !== "zen" || b.kind !== "zen") return a.kind === b.kind;
	return a.folder.length === b.folder.length && a.folder.every((name, at) => b.folder[at] === name);
}

/** A Zen folder: its name, its folders from the root down, how many bookmarks it and its subfolders hold, and its subfolders by name. */
export interface FolderNode {
	name: string;
	folder: string[];
	count: number;
	folders: FolderNode[];
}

/** The Zen folders `bookmarks` sit in, by name at each level. */
export function folderTree(bookmarks: readonly Bookmark[]): FolderNode[] {
	const root: FolderNode = { name: "", folder: [], count: 0, folders: [] };
	for (const bookmark of bookmarks) {
		if (bookmark.source !== "zen") continue;
		let node = root;
		for (const name of bookmark.folder) {
			let child = node.folders.find(folder => folder.name === name);
			if (!child) {
				child = { name, folder: [...node.folder, name], count: 0, folders: [] };
				node.folders.push(child);
			}
			child.count++;
			node = child;
		}
	}
	const sorted = (nodes: FolderNode[]): FolderNode[] => nodes.map(node => ({ ...node, folders: sorted(node.folders) })).sort((a, b) => a.name.localeCompare(b.name));
	return sorted(root.folders);
}

/** The folders of `nodes` in the order the tree lists them, each with how deep it sits. */
export const treeRows = (nodes: readonly FolderNode[], depth = 0): { node: FolderNode; depth: number }[] =>
	nodes.flatMap(node => [{ node, depth }, ...treeRows(node.folders, depth + 1)]);

export interface BookmarkGroup {
	source: BookmarkSource;
	/** The Zen folders joined, `No folder`, or `x.com`. */
	name: string;
	/** How many bookmarks the group holds, those past the list's cap included. */
	count: number;
	/** The group's bookmarks the list shows. */
	bookmarks: Bookmark[];
}

/** `bookmarks` by their exact Zen folder, folders by name, then the x.com posts, each group in the order given; the first `max` bookmarks show. */
export function bookmarkGroups(bookmarks: readonly Bookmark[], max: number): BookmarkGroup[] {
	const groups = new Map<string, BookmarkGroup>();
	for (const bookmark of bookmarks) {
		const name = bookmark.source === "x" ? "x.com" : bookmark.folder.join(" / ") || "No folder";
		const key = `${bookmark.source}:${name}`;
		const group = groups.get(key) ?? { source: bookmark.source, name, count: 0, bookmarks: [] };
		group.bookmarks.push(bookmark);
		group.count++;
		groups.set(key, group);
	}
	let room = max;
	return [...groups.values()]
		.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === "x" ? 1 : -1))
		.flatMap(group => {
			const shown = group.bookmarks.slice(0, room);
			room -= shown.length;
			return shown.length > 0 ? [{ ...group, bookmarks: shown }] : [];
		});
}
