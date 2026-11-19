/** What the Memory page reads from its data: the repository it shows, and the bookmarks a search and a source keep. */
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
