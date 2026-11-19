/** Every bookmark together: Zen's, read from its profile, and the posts the last X sync kept in its file. See docs/architecture/memory-page.md. */
import { readFileSync } from "node:fs";
import { isObject, parseJson } from "../json";
import type { Bookmark, XBookmark, ZenBookmark } from "../shared/memory-page";
import { readZenBookmarks } from "./zen";

/** What `bookmarks-x.json` keeps: the posts of the last sync that succeeded with when it ran, `null` before the first, and why the last sync failed. */
export interface XFile {
	synced: { at: string; bookmarks: XBookmark[] } | null;
	lastError: string | null;
}

const NO_X: XFile = { synced: null, lastError: null };

const isXBookmark = (value: unknown): value is XBookmark =>
	isObject(value) && value.source === "x" && [value.id, value.url, value.name, value.handle, value.text, value.addedAt].every(field => typeof field === "string");

/** The file at `path`, or no sync when it is missing, unreadable, or in another shape; a post not in the shape is left out. */
export function readXFile(path: string): XFile {
	let raw: unknown;
	try {
		raw = parseJson(readFileSync(path, "utf8"));
	} catch {
		return NO_X;
	}
	if (!isObject(raw)) return NO_X;
	const { synced, lastError } = raw;
	return {
		synced: isObject(synced) && typeof synced.at === "string" && Array.isArray(synced.bookmarks) ? { at: synced.at, bookmarks: synced.bookmarks.filter(isXBookmark) } : null,
		lastError: typeof lastError === "string" ? lastError : null,
	};
}

/** Every bookmark, newest first, whether Zen's profile was read, and the X file they came from. */
export interface BookmarksRead {
	bookmarks: Bookmark[];
	zenFound: boolean;
	x: XFile;
}

const newestFirst = (a: Bookmark, b: Bookmark): number => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0);

/** Zen's bookmarks, `null` when its profile was not read, and the posts `x` keeps, newest first. */
export function mergeBookmarks(zen: readonly ZenBookmark[] | null, x: XFile): BookmarksRead {
	return { bookmarks: [...(zen ?? []), ...(x.synced?.bookmarks ?? [])].sort(newestFirst), zenFound: zen !== null, x };
}

/** Every bookmark: Zen's, read from `profileDir` now, and the posts the X file at `xFile` keeps; none from a `null` one. */
export function readBookmarks(profileDir: string | null, xFile: string | null): BookmarksRead {
	return mergeBookmarks(profileDir === null ? null : readZenBookmarks(profileDir), xFile === null ? NO_X : readXFile(xFile));
}
