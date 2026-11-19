import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookmarkChunks, bookmarkLine, Bookmarks, bookmarksQueryIn, readXCookies, readZenBookmarks, searchBookmarks, xBookmarksPage, zenProfileDir } from "./bookmarks";
import type { Bookmark } from "./shared/memory-page";

const dirs: string[] = [];
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "bookmarks-test-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A Zen profile whose `places.sqlite` holds the toolbar's `Design` folder with one page, one tag, one query, and one page under the other bookmarks. */
function zenProfile(): string {
	const profile = tempDir();
	const db = new Database(join(profile, "places.sqlite"));
	db.run("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT)");
	db.run("CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT, dateAdded INTEGER, guid TEXT)");
	const folders: [number, number, string, string][] = [
		[1, 0, "", "root________"],
		[2, 1, "menu", "menu________"],
		[3, 1, "toolbar", "toolbar_____"],
		[4, 1, "tags", "tags________"],
		[5, 1, "unfiled", "unfiled_____"],
		[10, 3, "Design", "designfolder"],
		[11, 4, "inspiration", "tagfolder___"],
	];
	for (const [id, parent, title, guid] of folders) db.run("INSERT INTO moz_bookmarks (id, type, parent, title, guid, dateAdded) VALUES (?, 2, ?, ?, ?, 0)", [id, parent, title, guid]);
	const places: [number, string, string][] = [
		[1, "https://figma.com", "Figma"],
		[2, "place:sort=8", "Recent"],
		[3, "https://bun.sh", "Bun"],
	];
	for (const place of places) db.run("INSERT INTO moz_places (id, url, title) VALUES (?, ?, ?)", place);
	const rows: [number, number, string | null, number, string][] = [
		[1, 10, "", 1_700_000_000_000_000, "figmabookmrk"],
		[1, 11, null, 1_700_000_000_000_000, "figmatag____"],
		[2, 2, "Recent", 1_700_000_000_000_000, "placequery__"],
		[3, 5, "Bun runtime", 1_710_000_000_000_000, "bunbookmark_"],
	];
	for (const row of rows) db.run("INSERT INTO moz_bookmarks (type, fk, parent, title, dateAdded, guid) VALUES (1, ?, ?, ?, ?, ?)", row);
	db.close();
	return profile;
}

function withCookies(profile: string, rows: [string, string, string, number][]): void {
	const db = new Database(join(profile, "cookies.sqlite"));
	db.run("CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, lastAccessed INTEGER)");
	for (const row of rows) db.run("INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES (?, ?, ?, ?)", row);
	db.close();
}

describe("Zen", () => {
	test("reads each page bookmark with its folder path, and skips tags and queries", () => {
		expect(readZenBookmarks(zenProfile())).toEqual([
			{ id: "zen:figmabookmrk", source: "zen", url: "https://figma.com", title: "Figma", folder: "Toolbar / Design", text: null, author: null, addedAt: "2023-11-14T22:13:20.000Z" },
			{ id: "zen:bunbookmark_", source: "zen", url: "https://bun.sh", title: "Bun runtime", folder: "Other", text: null, author: null, addedAt: "2024-03-09T16:00:00.000Z" },
		]);
	});

	test("finds the profile the install opens", () => {
		const dir = tempDir();
		mkdirSync(join(dir, "Profiles", "abc.Default (release)"), { recursive: true });
		writeFileSync(join(dir, "profiles.ini"), "[Install1]\nDefault=Profiles/abc.Default (release)\n\n[Profile0]\nName=Other\nIsRelative=1\nPath=Profiles/other\nDefault=1\n");
		expect(zenProfileDir(dir)).toBe(join(dir, "Profiles", "abc.Default (release)"));
		expect(zenProfileDir(join(dir, "missing"))).toBeNull();
	});

	test("reads the newest x.com sign-in cookies", () => {
		const profile = tempDir();
		withCookies(profile, [
			["ct0", "old", ".x.com", 1],
			["ct0", "new", ".x.com", 2],
			["auth_token", "token", ".x.com", 1],
			["auth_token", "elsewhere", ".example.com", 3],
		]);
		expect(readXCookies(profile)).toEqual({ authToken: "token", ct0: "new" });
	});
});

const user = (handle: string, name: string) => ({ result: { __typename: "User", core: { name, screen_name: handle } } });
const tweetEntry = (result: unknown) => ({ entryId: "tweet", content: { entryType: "TimelineTimelineItem", itemContent: { tweet_results: { result } } } });
/** One page of X's `Bookmarks` answer, trimmed: a post, a long post seen through a visibility wrapper, a removed post, and the cursors. */
const X_PAGE = {
	data: {
		bookmark_timeline_v2: {
			timeline: {
				instructions: [
					{
						type: "TimelineAddEntries",
						entries: [
							tweetEntry({ __typename: "Tweet", rest_id: "111", core: { user_results: user("omarsar0", "elvis") }, legacy: { created_at: "Wed Nov 18 14:09:32 +0000 2026", full_text: "Strong primitives" } }),
							tweetEntry({
								__typename: "TweetWithVisibilityResults",
								tweet: {
									rest_id: "222",
									core: { user_results: { result: { legacy: { name: "Old Shape", screen_name: "old" } } } },
									legacy: { created_at: "Tue Nov 17 10:00:00 +0000 2026", full_text: "Cut…" },
									note_tweet: { note_tweet_results: { result: { text: "The whole long post" } } },
								},
							}),
							tweetEntry({ __typename: "TweetTombstone" }),
							{ entryId: "cursor-top-1", content: { entryType: "TimelineTimelineCursor", value: "TOP", cursorType: "Top" } },
							{ entryId: "cursor-bottom-1", content: { entryType: "TimelineTimelineCursor", value: "NEXT", cursorType: "Bottom" } },
						],
					},
				],
			},
		},
	},
};

describe("X", () => {
	test("maps a page of the Bookmarks answer to bookmarks and its next cursor", () => {
		expect(xBookmarksPage(X_PAGE)).toEqual({
			bookmarks: [
				{ id: "x:111", source: "x", url: "https://x.com/omarsar0/status/111", title: "elvis", folder: null, text: "Strong primitives", author: "@omarsar0", addedAt: "2026-11-18T14:09:32.000Z" },
				{ id: "x:222", source: "x", url: "https://x.com/old/status/222", title: "Old Shape", folder: null, text: "The whole long post", author: "@old", addedAt: "2026-11-17T10:00:00.000Z" },
			],
			cursor: "NEXT",
		});
		expect(xBookmarksPage({ errors: [{ message: "nope" }] })).toBeNull();
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

	test("syncs every page, keeps the posts, and never writes the cookies", async () => {
		const profile = zenProfile();
		withCookies(profile, [
			["auth_token", "secret-token", ".x.com", 1],
			["ct0", "secret-csrf", ".x.com", 1],
		]);
		const xFile = join(tempDir(), "bookmarks-x.json");
		const seen: string[] = [];
		const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
			seen.push(url);
			if (url === "https://x.com/home") return new Response('{1:"bundle.Bookmarks"};{1:"aaaaaaaaaaaaaaaa"}');
			if (url.endsWith(".js")) return new Response('queryId:"QID",operationName:"Bookmarks",operationType:"query",metadata:{featureSwitches:[],fieldToggles:[]}');
			expect(new Headers(init?.headers).get("x-csrf-token")).toBe("secret-csrf");
			const cursor = JSON.parse(new URL(url).searchParams.get("variables") ?? "{}").cursor;
			return Response.json(cursor ? { data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [] }] } } } } : X_PAGE);
		};
		const store = new Bookmarks({ profileDir: () => profile, xFile, fetch, now: () => new Date("2026-11-19T00:00:00Z") });
		const view = await store.syncX();
		expect(view.x).toEqual({ syncedAt: "2026-11-19T00:00:00.000Z", error: null, signedIn: true });
		expect(view.zenFound).toBe(true);
		expect(view.bookmarks.map(({ id }) => id)).toEqual(["x:111", "x:222", "zen:bunbookmark_", "zen:figmabookmrk"]);
		expect(seen.filter(url => url.includes("/graphql/QID/Bookmarks"))).toHaveLength(2);
		const kept = await Bun.file(xFile).text();
		expect(kept).not.toContain("secret");
	});

	test("keeps the last posts and says why when X refuses", async () => {
		const profile = zenProfile();
		withCookies(profile, [
			["auth_token", "t", ".x.com", 1],
			["ct0", "c", ".x.com", 1],
		]);
		const xFile = join(tempDir(), "bookmarks-x.json");
		writeFileSync(xFile, JSON.stringify({ bookmarks: xBookmarksPage(X_PAGE)?.bookmarks, syncedAt: "2026-11-01T00:00:00.000Z", error: null }));
		const store = new Bookmarks({ profileDir: () => profile, xFile, fetch: async () => new Response("", { status: 401 }) });
		const view = await store.syncX();
		expect(view.x).toEqual({ syncedAt: "2026-11-01T00:00:00.000Z", error: "X refused the request. Sign in to x.com in Zen again, then sync again.", signedIn: true });
		expect(view.bookmarks.filter(({ source }) => source === "x")).toHaveLength(2);
	});

	test("says Zen holds no sign-in without calling X", async () => {
		const store = new Bookmarks({ profileDir: () => zenProfile(), xFile: join(tempDir(), "x.json"), fetch: () => Promise.reject(new Error("no call")) });
		const view = await store.syncX();
		expect(view.x).toEqual({ syncedAt: null, error: "Zen holds no x.com sign-in. Sign in to x.com in Zen, then sync again.", signedIn: false });
	});
});

describe("search", () => {
	const list: Bookmark[] = [
		{ id: "zen:a", source: "zen", url: "https://figma.com", title: "Figma", folder: "Toolbar / Design", text: null, author: null, addedAt: "2024-01-01T00:00:00.000Z" },
		{ id: "x:1", source: "x", url: "https://x.com/a/status/1", title: "A", folder: null, text: "A Figma plugin for tokens", author: "@a", addedAt: "2026-01-01T00:00:00.000Z" },
		{ id: "x:2", source: "x", url: "https://x.com/b/status/2", title: "B", folder: null, text: "Bun news", author: "@b", addedAt: "2025-01-01T00:00:00.000Z" },
	];

	test("matches every word in any field, ignoring case, newest first", () => {
		expect(searchBookmarks(list, { query: "FIGMA" }).map(({ id }) => id)).toEqual(["x:1", "zen:a"]);
		expect(searchBookmarks(list, { query: "figma design" }).map(({ id }) => id)).toEqual(["zen:a"]);
		expect(searchBookmarks(list, { query: "figma", source: "zen" }).map(({ id }) => id)).toEqual(["zen:a"]);
		expect(searchBookmarks(list, { limit: 1 }).map(({ id }) => id)).toEqual(["x:1"]);
	});

	test("writes one compact line each", () => {
		expect(list.map(bookmarkLine)).toEqual([
			"2024-01-01 [zen] Toolbar / Design · Figma https://figma.com",
			"2026-01-01 [x] @a: A Figma plugin for tokens https://x.com/a/status/1",
			"2025-01-01 [x] @b: Bun news https://x.com/b/status/2",
		]);
	});
});
