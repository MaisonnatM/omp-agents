import { expect, test } from "bun:test";
import { type Bookmark, bookmarkMatcher, type XBookmark, type ZenBookmark } from "../../../src/shared/memory-page";
import { type BookmarkPlace, bookmarkGroups, folderTree, inPlace, treeRows } from "./bookmarks-view";

const page = (id: string, folder: string[], fields: Partial<ZenBookmark> = {}): ZenBookmark => ({ source: "zen", id, url: "https://example.com", title: "", folder, addedAt: "2026-11-19T00:00:00Z", ...fields });
const post = (id: string, fields: Partial<XBookmark> = {}): XBookmark => ({ source: "x", id, url: "https://x.com/a/status/1", name: "A", handle: "@a", text: "", lang: null, translation: null, media: [], addedAt: "2026-11-19T00:00:00Z", ...fields });

test("a search keeps the bookmarks holding every word in a page's title, address, or folders, or a post's author, text, or translation", () => {
	const bookmarks: Bookmark[] = [
		page("zen:1", ["Toolbar", "Design"], { title: "Spring physics", url: "https://www.joshwcomeau.com/animation" }),
		post("x:2", { name: "Emil", handle: "@emilkowalski", text: "Design engineering tips" }),
		page("zen:3", [], { title: "Bun docs", url: "https://bun.sh/docs" }),
	];
	const ids = (query: string) => bookmarks.filter(bookmarkMatcher(query)).map(({ id }) => id);
	expect(ids("")).toEqual(["zen:1", "x:2", "zen:3"]);
	expect(ids("design")).toEqual(["zen:1", "x:2"]);
	expect(ids("EMILKOWALSKI tips")).toEqual(["x:2"]);
	expect(ids("joshwcomeau spring")).toEqual(["zen:1"]);
	expect(ids("bun design")).toEqual([]);
	const french = post("x:4", { text: "Astuces de conception", lang: "fr", translation: "Design tips" });
	expect([bookmarkMatcher("design tips")(french), bookmarkMatcher("astuces")(french), bookmarkMatcher("recettes")(french)]).toEqual([true, true, false]);
});

test("the folder tree counts each Zen folder with its subfolders, and picking a folder keeps its subfolders' bookmarks", () => {
	const bookmarks = [post("x:1"), page("zen:2", ["Toolbar", "Design"]), page("zen:3", ["Toolbar"]), page("zen:4", ["Toolbar", "Design"]), page("zen:5", ["Menu"]), page("zen:6", ["Toolbar Extra"])];
	expect(treeRows(folderTree(bookmarks)).map(({ node, depth }) => [node.folder.join(" / "), node.count, depth])).toEqual([
		["Menu", 1, 0],
		["Toolbar", 3, 0],
		["Toolbar / Design", 2, 1],
		["Toolbar Extra", 1, 0],
	]);
	const ids = (place: BookmarkPlace) => bookmarks.filter(item => inPlace(place, item)).map(({ id }) => id);
	expect(ids({ kind: "zen", folder: ["Toolbar"] })).toEqual(["zen:2", "zen:3", "zen:4"]);
	expect(ids({ kind: "zen", folder: [] })).toEqual(["zen:2", "zen:3", "zen:4", "zen:5", "zen:6"]);
	expect(ids({ kind: "x" })).toEqual(["x:1"]);
});

test("the list groups by exact folder, then x.com, and counts each group past the cap", () => {
	const bookmarks = [post("x:1"), page("zen:2", ["Toolbar", "Design"]), page("zen:3", ["Toolbar"]), page("zen:4", ["Toolbar", "Design"]), page("zen:5", [])];
	const groups = (max: number) => bookmarkGroups(bookmarks, max).map(({ name, count, bookmarks: shown }) => [name, count, shown.map(({ id }) => id)]);
	expect(groups(10)).toEqual([
		["No folder", 1, ["zen:5"]],
		["Toolbar", 1, ["zen:3"]],
		["Toolbar / Design", 2, ["zen:2", "zen:4"]],
		["x.com", 1, ["x:1"]],
	]);
	expect(groups(3)).toEqual([
		["No folder", 1, ["zen:5"]],
		["Toolbar", 1, ["zen:3"]],
		["Toolbar / Design", 2, ["zen:2"]],
	]);
});
