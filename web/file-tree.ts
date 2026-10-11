/** Files as a tree of folders, for the explorers of the changes page and the repository page. */

export interface TreeDir<F extends { path: string }> {
	/** Its name in its parent, which joins a chain of single-directory folders: `src/server`. */
	name: string;
	/** Its path from the root, which keys its open state. */
	path: string;
	dirs: TreeDir<F>[];
	files: F[];
}

/**
 * The files as folders, directories first and each level by name; a folder holding one folder and no file joins it.
 * An absolute path, a file the session changed outside its checkout, hangs under a `/` folder.
 */
export function fileTree<F extends { path: string }>(files: readonly F[]): TreeDir<F> {
	type Building = { name: string; path: string; dirs: Map<string, Building>; files: F[] };
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
	const settle = (node: Building): TreeDir<F> => {
		const dirs = [...node.dirs.values()].map(settle).sort((a, b) => a.name.localeCompare(b.name));
		const files = node.files.toSorted((a, b) => a.path.localeCompare(b.path));
		const only = dirs[0];
		if (node.name && files.length === 0 && dirs.length === 1 && only) return { ...only, name: `${node.name === "/" ? "" : node.name}/${only.name}` };
		return { name: node.name, path: node.path, dirs, files };
	};
	return settle(root);
}

/** The files in the explorer's order, which ↓ and ↑ walk. */
export const treeOrder = <F extends { path: string }>(dir: TreeDir<F>): F[] => [...dir.dirs.flatMap(treeOrder), ...dir.files];

/** The paths of the folders that hold `path`, outermost first, which must be open for its row to show; `null` when no folder holds it. */
export function foldersAbove<F extends { path: string }>(dir: TreeDir<F>, path: string): string[] | null {
	if (dir.files.some(file => file.path === path)) return [];
	for (const child of dir.dirs) {
		const above = foldersAbove(child, path);
		if (above) return [child.path, ...above];
	}
	return null;
}
