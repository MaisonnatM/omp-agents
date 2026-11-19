/** Every bookmark together: Zen's, read from its profile, and the posts the last X sync kept in its file. See docs/architecture/memory-page.md. */
import { readFileSync } from "node:fs";
import { isObject, parseJson } from "../json";
import type { Bookmark, XBookmark, XMedia, ZenBookmark } from "../shared/memory-page";
import { readZenBookmarks } from "./zen";

/** What `bookmarks-x.json` keeps: the posts of the last sync that succeeded with when it ran, `null` before the first, and why the last sync failed. */
export interface XFile {
	synced: { at: string; bookmarks: XBookmark[] } | null;
	lastError: string | null;
}

const NO_X: XFile = { synced: null, lastError: null };

const isText = (value: unknown): value is string => typeof value === "string";
const isOptionalText = (value: unknown): value is string | null | undefined => value === undefined || value === null || isText(value);
const isSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function xMediaOf(value: unknown): XMedia | null {
	if (!isObject(value)) return null;
	const { kind, url, width, height, video, alt } = value;
	if ((kind !== "photo" && kind !== "video" && kind !== "gif") || !isText(url) || !isSize(width) || !isSize(height) || !isOptionalText(video) || !isOptionalText(alt)) return null;
	return { kind, url, width, height, video: video ?? null, alt: alt ?? null };
}

/** `value` as a post, `null` when a field is missing or not text; a file from before translations and media reads with none. */
function xBookmarkOf(value: unknown): XBookmark | null {
	if (!isObject(value) || value.source !== "x") return null;
	const { id, url, name, handle, text, addedAt, lang, translation, media } = value;
	if (!isText(id) || !isText(url) || !isText(name) || !isText(handle) || !isText(text) || !isText(addedAt) || !isOptionalText(lang) || !isOptionalText(translation)) return null;
	return { source: "x", id, url, name, handle, text, addedAt, lang: lang ?? null, translation: translation ?? null, media: Array.isArray(media) ? media.flatMap(item => xMediaOf(item) ?? []) : [] };
}

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
		synced: isObject(synced) && typeof synced.at === "string" && Array.isArray(synced.bookmarks) ? { at: synced.at, bookmarks: synced.bookmarks.flatMap(post => xBookmarkOf(post) ?? []) } : null,
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
