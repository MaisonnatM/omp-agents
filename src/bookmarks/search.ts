/** The `bookmarks` tool's search and its one line per bookmark. See docs/architecture/memory-page.md. */
import { type Bookmark, type BookmarkSource, bookmarkMatcher } from "../shared/memory-page";

/** What the `bookmarks` tool searches: a query whose every word must appear, one source, and how many to return. */
export interface BookmarkSearch {
	query?: string;
	source?: BookmarkSource;
	limit?: number;
}

export const DEFAULT_SEARCH_LIMIT = 20;

/** The first `limit` of `bookmarks`, which come newest first, that hold every word of `query`, from `source` when given. */
export function searchBookmarks(bookmarks: readonly Bookmark[], { query = "", source, limit = DEFAULT_SEARCH_LIMIT }: BookmarkSearch): Bookmark[] {
	return bookmarks.filter(bookmarkMatcher(query, source)).slice(0, limit);
}

/** `value` on one line, cut to `max` characters. */
function clipped(value: string, max: number): string {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** One bookmark as one compact line: the day, the source, where it sits or who posted it, what it says, a post's English first, and its URL. */
export function bookmarkLine(bookmark: Bookmark): string {
	const day = bookmark.addedAt.slice(0, 10);
	if (bookmark.source === "x") {
		const says = bookmark.translation === null ? clipped(bookmark.text, 240) : `${clipped(bookmark.translation, 240)} (original, ${bookmark.lang}: ${clipped(bookmark.text, 160)})`;
		return `${day} [x] ${bookmark.handle}: ${says} ${bookmark.url}`;
	}
	const folder = bookmark.folder.join(" / ");
	return `${day} [zen]${folder ? ` ${folder} ·` : ""} ${clipped(bookmark.title, 160)} ${bookmark.url}`;
}
