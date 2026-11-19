/** The bookmark tests' fixtures: temp Zen profiles with their databases, and a trimmed page of X's `Bookmarks` answer. */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

export function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "bookmarks-test-"));
	dirs.push(dir);
	return dir;
}

/** Deletes every directory {@link tempDir} made; each test file runs it after each test. */
export function removeTempDirs(): void {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Adds a page bookmark to the profile's `places.sqlite`, under the folder `parent`. */
export function addZenBookmark(profile: string, [place, parent, title, dateAdded, guid]: [number, number, string | null, number, string]): void {
	const db = new Database(join(profile, "places.sqlite"));
	db.run("INSERT INTO moz_bookmarks (type, fk, parent, title, dateAdded, guid) VALUES (1, ?, ?, ?, ?, ?)", [place, parent, title, dateAdded, guid]);
	db.close();
}

/** A Zen profile whose `places.sqlite` holds the toolbar's `Design` folder with one page, one tag, one query, and one page under the other bookmarks. */
export function zenProfile(): string {
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
	db.close();
	addZenBookmark(profile, [1, 10, "", 1_700_000_000_000_000, "figmabookmrk"]);
	addZenBookmark(profile, [1, 11, null, 1_700_000_000_000_000, "figmatag____"]);
	addZenBookmark(profile, [2, 2, "Recent", 1_700_000_000_000_000, "placequery__"]);
	addZenBookmark(profile, [3, 5, "Bun runtime", 1_710_000_000_000_000, "bunbookmark_"]);
	return profile;
}

/** Writes the profile's `cookies.sqlite` with `rows` of name, value, host, and last access. */
export function withCookies(profile: string, rows: [string, string, string, number][]): void {
	const db = new Database(join(profile, "cookies.sqlite"));
	db.run("CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, lastAccessed INTEGER)");
	for (const row of rows) db.run("INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES (?, ?, ?, ?)", row);
	db.close();
}

export const xUser = (handle: string, name: string) => ({ result: { __typename: "User", core: { name, screen_name: handle } } });
export const tweetEntry = (result: unknown) => ({ entryId: "tweet", content: { entryType: "TimelineTimelineItem", itemContent: { tweet_results: { result } } } });

/** One page of X's `Bookmarks` answer, trimmed: a post, a long post seen through a visibility wrapper, a removed post, and the cursors. */
export const X_PAGE = {
	data: {
		bookmark_timeline_v2: {
			timeline: {
				instructions: [
					{
						type: "TimelineAddEntries",
						entries: [
							tweetEntry({ __typename: "Tweet", rest_id: "111", core: { user_results: xUser("omarsar0", "elvis") }, legacy: { created_at: "Wed Nov 18 14:09:32 +0000 2026", full_text: "Strong primitives" } }),
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
