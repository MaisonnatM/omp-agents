/** What the Memory page reads from its data: the repository it shows, and the bookmarks a search, a source, and a folder keep. */
import { everyWord } from "../src/shared/every-word";
import type { Bookmark, BookmarkSource, ProjectMemoryRepo } from "../src/shared/memory-page";

/**
 * The repository the Project memory tab shows: `wanted`, which the address names, else the one holding `cwd`, the sidebar's
 * workspace, else the first; `null` with none.
 */
export function shownRepo(repos: readonly ProjectMemoryRepo[], wanted: string | null, cwd: string | null): ProjectMemoryRepo | null {
	const named = wanted === null ? undefined : repos.find(repo => repo.root === wanted);
	if (named) return named;
	const holding = cwd === null ? undefined : repos.find(repo => cwd === repo.root || cwd.startsWith(`${repo.root}/`));
	return holding ?? repos[0] ?? null;
}

/** The Bookmarks tab's source filter: every source, or one. */
export type BookmarkFilter = "all" | BookmarkSource;

/** The bookmarks from `source` holding every word of `query` in their title, address, folder, author, or text, in the order given. */
export function filterBookmarks(bookmarks: readonly Bookmark[], query: string, source: BookmarkFilter): Bookmark[] {
	const matches = everyWord(query);
	return bookmarks.filter(bookmark => (source === "all" || bookmark.source === source) && matches([bookmark.title, bookmark.url, bookmark.folder, bookmark.author, bookmark.text].filter(Boolean).join("\n")));
}

/** The Bookmarks tab's folder tree pick: every bookmark, the x.com posts, or the Zen folder at `path` with its subfolders, `""` for all of Zen. */
export type BookmarkPlace = { kind: "all" } | { kind: "x" } | { kind: "zen"; path: string };

/** Separates the folders of a Zen folder path: `Toolbar / Design`. */
export const FOLDER_SEPARATOR = " / ";
/** The group of the x.com posts, and of a Zen bookmark outside any folder. */
export const X_GROUP = "x.com";
export const NO_FOLDER = "No folder";

export function inPlace(place: BookmarkPlace, bookmark: Bookmark): boolean {
	if (place.kind === "all") return true;
	if (place.kind === "x") return bookmark.source === "x";
	if (bookmark.source !== "zen") return false;
	const folder = bookmark.folder ?? NO_FOLDER;
	return place.path === "" || folder === place.path || folder.startsWith(`${place.path}${FOLDER_SEPARATOR}`);
}

/** How many of the Zen bookmarks in `bookmarks` each folder path holds, its subfolders' included. */
export function folderCounts(bookmarks: readonly Bookmark[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const bookmark of bookmarks) {
		if (bookmark.source !== "zen") continue;
		const parts = (bookmark.folder ?? NO_FOLDER).split(FOLDER_SEPARATOR);
		for (let end = 1; end <= parts.length; end++) {
			const path = parts.slice(0, end).join(FOLDER_SEPARATOR);
			counts.set(path, (counts.get(path) ?? 0) + 1);
		}
	}
	return counts;
}

export interface BookmarkGroup {
	/** The Zen folder path, {@link NO_FOLDER}, or {@link X_GROUP}. */
	name: string;
	bookmarks: Bookmark[];
}

/** `bookmarks` by their exact Zen folder, folders by name, then the x.com posts, each group in the order given. */
export function bookmarkGroups(bookmarks: readonly Bookmark[]): BookmarkGroup[] {
	const groups = new Map<string, Bookmark[]>();
	for (const bookmark of bookmarks) {
		const name = bookmark.source === "x" ? X_GROUP : (bookmark.folder ?? NO_FOLDER);
		const group = groups.get(name);
		if (group) group.push(bookmark);
		else groups.set(name, [bookmark]);
	}
	return [...groups]
		.map(([name, grouped]) => ({ name, bookmarks: grouped }))
		.sort((a, b) => (a.name === X_GROUP ? 1 : b.name === X_GROUP ? -1 : a.name.localeCompare(b.name)));
}
