import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { XBookmark } from "../shared/memory-page";
import { removeTempDirs, tempDir, tweetEntry, withCookies, xUser, zenProfile } from "./fixtures";
import { Bookmarks } from "./service";
import { translatePosts } from "./translate";

afterEach(removeTempDirs);

const post = (id: string, lang: string | null, text: string, translation: string | null = null): XBookmark => ({
	source: "x",
	id,
	url: `https://x.com/a/status/${id}`,
	name: "A",
	handle: "@a",
	text,
	lang,
	translation,
	addedAt: "2026-11-19T00:00:00.000Z",
});

/** Google's answer: the English in segments, as `[[[english, original, …], …], …]`. */
const google = (...segments: string[]): Response => Response.json([segments.map(segment => [segment, "", null, null]), null, "fr"]);

test("translates the posts in another language, keeps a translation the last sync made for the same text, and leaves English alone", async () => {
	const asked: string[] = [];
	const fetch = async (url: string): Promise<Response> => {
		const text = new URL(url).searchParams.get("q") ?? "";
		asked.push(text);
		if (text === "Data viz components") return google("Data viz ", "components");
		return google("Hello, ", text === "Bonjour le monde" ? "world" : "again");
	};
	const posts = [post("1", "fr", "Bonjour le monde"), post("2", "en", "Hello"), post("3", "und", "🙂"), post("4", null, "Hallo"), post("5", "de", "Hallo"), post("6", "es", "Hola de nuevo"), post("7", "es", "Data viz components")];
	const kept = [post("5", "de", "Hallo", "Hello"), post("6", "es", "Hola", "Hi")];
	const out = await translatePosts(fetch, posts, kept);
	expect(out.map(({ id, translation }) => [id, translation])).toEqual([
		["1", "Hello, world"],
		["2", null],
		["3", null],
		["4", null],
		["5", "Hello"],
		["6", "Hello, again"],
		["7", null],
	]);
	expect(asked.sort()).toEqual(["Bonjour le monde", "Data viz components", "Hola de nuevo"]);
});

test("a translation Google refuses stays empty, and the sync still keeps the posts", async () => {
	const profile = zenProfile();
	withCookies(profile, [
		["auth_token", "secret-token", ".x.com", 1],
		["ct0", "secret-csrf", ".x.com", 1],
	]);
	const xFile = join(tempDir(), "bookmarks-x.json");
	writeFileSync(xFile, JSON.stringify({ synced: { at: "2026-11-01T00:00:00.000Z", bookmarks: [{ source: "x", id: "x:9", url: "https://x.com/a/status/9", name: "A", handle: "@a", text: "Older shape", addedAt: "2026-11-01T00:00:00.000Z" }] }, lastError: null }));
	const french = tweetEntry({ __typename: "Tweet", rest_id: "777", core: { user_results: xUser("fr", "Jean") }, legacy: { created_at: "Wed Nov 18 14:09:32 +0000 2026", full_text: "Bonjour", lang: "fr" } });
	const fetch = async (url: string): Promise<Response> => {
		if (url.startsWith("https://translate.googleapis.com/")) return new Response("busy", { status: 429 });
		if (url === "https://x.com/home") return new Response('{1:"bundle.Bookmarks"};{1:"aaaaaaaaaaaaaaaa"}');
		if (url.endsWith(".js")) return new Response('queryId:"QID",operationName:"Bookmarks",operationType:"query",metadata:{featureSwitches:[],fieldToggles:[]}');
		return Response.json({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [french] }] } } } });
	};
	const store = new Bookmarks({ profileDir: () => null, xFile, fetch });
	expect(store.view().bookmarks).toMatchObject([{ id: "x:9", lang: null, translation: null }]);
	const view = await new Bookmarks({ profileDir: () => profile, xFile, fetch }).syncX();
	expect(view.x.error).toBeNull();
	expect(view.bookmarks.filter(({ source }) => source === "x")).toMatchObject([{ id: "x:777", text: "Bonjour", lang: "fr", translation: null }]);
});
