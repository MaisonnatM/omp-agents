import { expect, test } from "bun:test";
import type { Bookmark, ProjectMemoryRepo } from "../src/shared/memory-page";
import { routeFromHash } from "./routing";
import { type BookmarkPlace, bookmarkGroups, filterBookmarks, folderCounts, inPlace, shownRepo } from "./memory-view";
import { memoryHash } from "./components/memory/tabs";
import type { MemoryRoute } from "./components/memory/module";

const repo = (root: string): ProjectMemoryRepo => ({ root, rootDisplay: root, name: root.split("/").pop()!, memories: [] });

test("the Project memory tab shows the repository the address names, else the workspace's, else the first", () => {
	const repos = [repo("/code/a"), repo("/code/ab"), repo("/code/b")];
	expect(shownRepo(repos, "/code/b", "/code/a")?.root).toBe("/code/b");
	expect(shownRepo(repos, "/code/gone", "/code/ab/web")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/code/ab")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/elsewhere")?.root).toBe("/code/a");
	expect(shownRepo([], null, null)).toBeNull();
});

const bookmark = (id: string, fields: Partial<Bookmark>): Bookmark => ({
	id,
	source: "zen",
	url: "https://example.com",
	title: "",
	folder: null,
	text: null,
	author: null,
	addedAt: "2026-11-19T00:00:00Z",
	...fields,
});

test("a bookmark search keeps those holding every word, in their title, address, folder, author, or text, from the source picked", () => {
	const bookmarks = [
		bookmark("zen:1", { title: "Spring physics", folder: "Toolbar / Design", url: "https://www.joshwcomeau.com/animation" }),
		bookmark("x:2", { source: "x", title: "Emil", author: "@emilkowalski", text: "Design engineering tips", url: "https://x.com/emilkowalski/status/2" }),
		bookmark("zen:3", { title: "Bun docs", url: "https://bun.sh/docs" }),
	];
	const ids = (query: string, source: "all" | "zen" | "x" = "all") => filterBookmarks(bookmarks, query, source).map(({ id }) => id);
	expect(ids("")).toEqual(["zen:1", "x:2", "zen:3"]);
	expect(ids("design")).toEqual(["zen:1", "x:2"]);
	expect(ids("design", "x")).toEqual(["x:2"]);
	expect(ids("", "zen")).toEqual(["zen:1", "zen:3"]);
	expect(ids("EMILKOWALSKI tips")).toEqual(["x:2"]);
	expect(ids("joshwcomeau spring")).toEqual(["zen:1"]);
	expect(ids("bun design")).toEqual([]);
});

test("memory routes open omp memory, a repository's project memory, and a bookmark search, and round-trip", () => {
	const routes: [MemoryRoute, string][] = [
		[{ tab: "omp" }, "#memory"],
		[{ tab: "project", repo: null }, "#memory/project"],
		[{ tab: "project", repo: "/Users/me/code/omp agents" }, "#memory/project?repo=%2FUsers%2Fme%2Fcode%2Fomp%20agents"],
		[{ tab: "bookmarks", q: "" }, "#memory/bookmarks"],
		[{ tab: "bookmarks", q: "spring & design" }, "#memory/bookmarks?q=spring%20%26%20design"],
	];
	for (const [route, hash] of routes) {
		expect(memoryHash(route)).toBe(hash);
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "memory", ...route } });
	}
	expect(routeFromHash("#memory/elsewhere")).toEqual({ kind: "page", page: { kind: "memory", tab: "omp" } });
});

test("the folder tree counts each Zen folder with its subfolders, picks a folder with them, and groups by folder, then x.com", () => {
	const bookmarks = [
		bookmark("x:1", { source: "x" }),
		bookmark("zen:2", { folder: "Toolbar / Design" }),
		bookmark("zen:3", { folder: "Toolbar" }),
		bookmark("zen:4", { folder: "Toolbar / Design" }),
		bookmark("zen:5", { folder: "Menu" }),
		bookmark("zen:6", { folder: "Toolbar Extra" }),
	];
	expect(Object.fromEntries(folderCounts(bookmarks))).toEqual({ Toolbar: 3, "Toolbar / Design": 2, Menu: 1, "Toolbar Extra": 1 });
	const ids = (place: BookmarkPlace) => bookmarks.filter(item => inPlace(place, item)).map(({ id }) => id);
	expect(ids({ kind: "zen", path: "Toolbar" })).toEqual(["zen:2", "zen:3", "zen:4"]);
	expect(ids({ kind: "zen", path: "" })).toEqual(["zen:2", "zen:3", "zen:4", "zen:5", "zen:6"]);
	expect(ids({ kind: "x" })).toEqual(["x:1"]);
	expect(bookmarkGroups(bookmarks).map(({ name, bookmarks: grouped }) => [name, grouped.map(({ id }) => id)])).toEqual([
		["Menu", ["zen:5"]],
		["Toolbar", ["zen:3"]],
		["Toolbar / Design", ["zen:2", "zen:4"]],
		["Toolbar Extra", ["zen:6"]],
		["x.com", ["x:1"]],
	]);
});
