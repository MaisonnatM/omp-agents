import { expect, test } from "bun:test";
import { tweetEntry, X_PAGE, xUser } from "./fixtures";
import { bookmarkChunks, bookmarksQueryIn, xBookmarksPage } from "./x-sync";

test("maps a page of the Bookmarks answer to bookmarks, with the language X detected, and its next cursor", () => {
	expect(xBookmarksPage(X_PAGE)).toEqual({
		bookmarks: [
			{ source: "x", id: "x:111", url: "https://x.com/omarsar0/status/111", name: "elvis", handle: "@omarsar0", text: "Strong primitives", lang: "en", translation: null, addedAt: "2026-11-18T14:09:32.000Z" },
			{ source: "x", id: "x:222", url: "https://x.com/old/status/222", name: "Old Shape", handle: "@old", text: "The whole long post", lang: null, translation: null, addedAt: "2026-11-17T10:00:00.000Z" },
		],
		cursor: "NEXT",
	});
	expect(xBookmarksPage({ errors: [{ message: "nope" }] })).toBeNull();
});

test("decodes the character references X escapes in a post's author name and text", () => {
	const post = tweetEntry({ __typename: "Tweet", rest_id: "333", core: { user_results: xUser("esc", "Tom &amp; Jerry") }, legacy: { created_at: "Mon Nov 16 09:00:00 +0000 2026", full_text: "100 PRs/week &gt; 1200 &lt;3 &amp; more" } });
	const page = xBookmarksPage({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [post] }] } } } });
	expect(page?.bookmarks.map(({ name, text }) => ({ name, text }))).toEqual([{ name: "Tom & Jerry", text: "100 PRs/week > 1200 <3 & more" }]);
});

test("finds the Bookmarks query in the page's chunks, with the page's feature values", () => {
	const html = 'x={69742:"bundle.Bookmarks",34778:"shared~bundle.BookmarkFolders~bundle.Bookmarks",1:"bundle.Home"};y={69742:"333a5c168651be6d",34778:"0123456789abcdef"};"on_flag":{"value":true},"off_flag":{"value":false}';
	expect(bookmarkChunks(html)).toEqual([
		"https://abs.twimg.com/responsive-web/client-web/bundle.Bookmarks.333a5c168651be6da.js",
		"https://abs.twimg.com/responsive-web/client-web/shared~bundle.BookmarkFolders~bundle.Bookmarks.0123456789abcdefa.js",
	]);
	const script = 'e.exports={queryId:"QID",operationName:"Bookmarks",operationType:"query",metadata:{featureSwitches:["on_flag","off_flag","unknown_flag"],fieldToggles:["withPayments"]}}';
	expect(bookmarksQueryIn(html, script)).toEqual({ queryId: "QID", features: { on_flag: true, off_flag: false, unknown_flag: false }, fieldToggles: { withPayments: false } });
	expect(bookmarksQueryIn(html, "nothing here")).toBeNull();
});
