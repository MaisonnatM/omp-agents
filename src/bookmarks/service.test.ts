import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { addZenBookmark, removeTempDirs, tempDir, withCookies, X_PAGE, zenProfile } from "./fixtures";
import { Bookmarks } from "./service";
import { readBookmarks } from "./store";
import { xBookmarksPage } from "./x-sync";

afterEach(removeTempDirs);

const signedIn = (profile: string): void =>
	withCookies(profile, [
		["auth_token", "secret-token", ".x.com", 1],
		["ct0", "secret-csrf", ".x.com", 1],
	]);

test("syncs every page, keeps the posts, and never writes the cookies", async () => {
	const profile = zenProfile();
	signedIn(profile);
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
	expect(await Bun.file(xFile).text()).not.toContain("secret");
	expect(store.view()).toEqual(view);
});

test("keeps the last posts and says why when X refuses", async () => {
	const profile = zenProfile();
	signedIn(profile);
	const xFile = join(tempDir(), "bookmarks-x.json");
	writeFileSync(xFile, JSON.stringify({ synced: { at: "2026-11-01T00:00:00.000Z", bookmarks: xBookmarksPage(X_PAGE)?.bookmarks }, lastError: null }));
	const store = new Bookmarks({ profileDir: () => profile, xFile, fetch: async () => new Response("", { status: 401 }) });
	const view = await store.syncX();
	expect(view.x).toEqual({ syncedAt: "2026-11-01T00:00:00.000Z", error: "X refused the request. Sign in to x.com in Zen again, then sync again.", signedIn: true });
	expect(view.bookmarks.filter(({ source }) => source === "x")).toHaveLength(2);
	expect(store.view()).toEqual(view);
});

test("says Zen holds no sign-in without calling X", async () => {
	const store = new Bookmarks({ profileDir: () => zenProfile(), xFile: join(tempDir(), "x.json"), fetch: () => Promise.reject(new Error("no call")) });
	const view = await store.syncX();
	expect(view.x).toEqual({ syncedAt: null, error: "Zen holds no x.com sign-in. Sign in to x.com in Zen, then sync again.", signedIn: false });
});

test("shows a bookmark added in Zen at the next read, and leaves out posts kept in another shape", () => {
	const profile = zenProfile();
	const xFile = join(tempDir(), "bookmarks-x.json");
	writeFileSync(xFile, JSON.stringify({ synced: { at: "2026-11-01T00:00:00.000Z", bookmarks: [{ source: "x", id: "x:1", url: "https://x.com/a/status/1", title: "A" }] }, lastError: null }));
	const store = new Bookmarks({ profileDir: () => profile, xFile, fetch: () => Promise.reject(new Error("no call")) });
	expect(store.view().bookmarks.map(({ id }) => id)).toEqual(["zen:bunbookmark_", "zen:figmabookmrk"]);
	addZenBookmark(profile, [3, 10, "Bun again", 1_720_000_000_000_000, "bunagain____"]);
	expect(store.view().bookmarks.map(({ id }) => id)).toEqual(["zen:bunagain____", "zen:bunbookmark_", "zen:figmabookmrk"]);
});

test("the tool's read says when Zen's profile is missing and when X never synced", () => {
	expect(readBookmarks(null, null)).toEqual({ bookmarks: [], zenFound: false, x: { synced: null, lastError: null } });
});
