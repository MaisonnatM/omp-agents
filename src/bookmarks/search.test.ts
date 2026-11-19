import { expect, test } from "bun:test";
import type { Bookmark } from "../shared/memory-page";
import { bookmarkLine, searchBookmarks } from "./search";

const list: Bookmark[] = [
	{ source: "x", id: "x:1", url: "https://x.com/a/status/1", name: "A", handle: "@a", text: "A Figma plugin for tokens", lang: "en", translation: null, media: [], addedAt: "2026-01-01T00:00:00.000Z" },
	{ source: "x", id: "x:2", url: "https://x.com/b/status/2", name: "B", handle: "@b", text: "Nouvelles de Bun", lang: "fr", translation: "Bun news", media: [], addedAt: "2025-01-01T00:00:00.000Z" },
	{ source: "zen", id: "zen:a", url: "https://figma.com", title: "Figma", folder: ["Toolbar", "Design"], addedAt: "2024-01-01T00:00:00.000Z" },
];

test("matches every word in a page's title, address, or folders, or a post's author, text, translation, or address, ignoring case", () => {
	expect(searchBookmarks(list, { query: "FIGMA" }).map(({ id }) => id)).toEqual(["x:1", "zen:a"]);
	expect(searchBookmarks(list, { query: "figma design" }).map(({ id }) => id)).toEqual(["zen:a"]);
	expect(searchBookmarks(list, { query: "@b news" }).map(({ id }) => id)).toEqual(["x:2"]);
	expect(searchBookmarks(list, { query: "nouvelles" }).map(({ id }) => id)).toEqual(["x:2"]);
	expect(searchBookmarks(list, { query: "figma", source: "zen" }).map(({ id }) => id)).toEqual(["zen:a"]);
	expect(searchBookmarks(list, { limit: 1 }).map(({ id }) => id)).toEqual(["x:1"]);
});

test("writes one compact line each, with a page's folders joined and a post's English before its original", () => {
	expect(list.map(bookmarkLine)).toEqual([
		"2026-01-01 [x] @a: A Figma plugin for tokens https://x.com/a/status/1",
		"2025-01-01 [x] @b: Bun news (original, fr: Nouvelles de Bun) https://x.com/b/status/2",
		"2024-01-01 [zen] Toolbar / Design · Figma https://figma.com",
	]);
});
