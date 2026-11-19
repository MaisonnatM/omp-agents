/**
 * The Memory module's bookmarks: Zen's, read from its profile's `places.sqlite`, and the x.com posts you bookmarked,
 * fetched through the cookies of your signed-in Zen session and kept in a JSON file until the next sync. See
 * docs/architecture/memory-page.md.
 */
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { atomicWriteText } from "./fs";
import { decodeEntities } from "./html-text";
import { isObject, parseJson } from "./json";
import type { Bookmark, BookmarkSource, BookmarksView, XSyncState } from "./shared/memory-page";

/** Where Zen keeps its profiles and `profiles.ini` on macOS. */
export const zenDir = (home: string): string => join(home, "Library", "Application Support", "zen");

/** The profile Zen opens, as `profiles.ini` in `dir` names it: the install's default, else the profile marked default; `null` when there is none. */
export function zenProfileDir(dir: string): string | null {
	let ini: string;
	try {
		ini = readFileSync(join(dir, "profiles.ini"), "utf8");
	} catch {
		return null;
	}
	const sections: Record<string, string>[] = [];
	for (const line of ini.split(/\r?\n/)) {
		if (/^\[.*\]$/.test(line.trim())) sections.push({ section: line.trim().slice(1, -1) });
		else {
			const at = line.indexOf("=");
			const current = sections.at(-1);
			if (at > 0 && current) current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
		}
	}
	const install = sections.find(({ section, Default }) => section?.startsWith("Install") && Default)?.Default;
	const marked = sections.find(({ section, Default, Path }) => section?.startsWith("Profile") && Default === "1" && Path);
	const relative = install ?? marked?.Path;
	if (!relative) return null;
	const path = marked && !install && marked.IsRelative === "0" ? relative : join(dir, relative);
	return existsSync(path) ? path : null;
}

/**
 * Runs `read` on a copy of the database at `path` with its write-ahead log, so the rows Zen has not checkpointed yet
 * count too; Zen holds the original locked while it runs. The copy is deleted after.
 */
function withSnapshot<T>(path: string, read: (db: Database) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-zen-"));
	try {
		const copy = join(dir, basename(path));
		cpSync(path, copy);
		if (existsSync(`${path}-wal`)) cpSync(`${path}-wal`, `${copy}-wal`);
		const db = new Database(copy);
		try {
			return read(db);
		} finally {
			db.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** A folder row of `moz_bookmarks`. */
export interface ZenFolder {
	id: number;
	parent: number;
	title: string | null;
	guid: string;
}

/** A bookmark row of `moz_bookmarks` joined to its `moz_places` row; `dateAdded` in microseconds. */
export interface ZenRow {
	guid: string;
	parent: number;
	url: string;
	title: string | null;
	dateAdded: number;
}

/** The roots Zen names by guid, as its bookmarks menu calls them; the tags root holds only tags, so its bookmarks never show. */
const ROOT_NAMES: Record<string, string | null> = {
	root________: null,
	menu________: "Menu",
	toolbar_____: "Toolbar",
	unfiled_____: "Other",
	mobile______: "Mobile",
	tags________: null,
};
const TAGS_ROOT = "tags________";

/** The rows as bookmarks, each with its folder path from the root down, such as `Toolbar / Design`; none under the tags root or for a `place:` query. */
export function zenBookmarks(folders: readonly ZenFolder[], rows: readonly ZenRow[]): Bookmark[] {
	const byId = new Map(folders.map(folder => [folder.id, folder]));
	const paths = new Map<number, string[] | null>();
	const pathOf = (id: number): string[] | null => {
		const known = paths.get(id);
		if (known !== undefined) return known;
		const folder = byId.get(id);
		let path: string[] | null;
		if (!folder || folder.guid === TAGS_ROOT) path = folder ? null : [];
		else if (folder.guid in ROOT_NAMES) path = ROOT_NAMES[folder.guid] ? [ROOT_NAMES[folder.guid] as string] : [];
		else {
			paths.set(id, []);
			const above = pathOf(folder.parent);
			path = above && [...above, folder.title || "Untitled"];
		}
		paths.set(id, path);
		return path;
	};
	return rows.flatMap(({ guid, parent, url, title, dateAdded }) => {
		const folder = pathOf(parent);
		if (!folder || url.startsWith("place:")) return [];
		return [{ id: `zen:${guid}`, source: "zen" as const, url, title: title || url, folder: folder.join(" / ") || null, text: null, author: null, addedAt: new Date(dateAdded / 1000).toISOString() }];
	});
}

/** Zen's bookmarks in the profile `profileDir`, or `null` when it holds no `places.sqlite`. */
export function readZenBookmarks(profileDir: string): Bookmark[] | null {
	const places = join(profileDir, "places.sqlite");
	if (!existsSync(places)) return null;
	return withSnapshot(places, db =>
		zenBookmarks(
			db.query<ZenFolder, []>("SELECT id, parent, title, guid FROM moz_bookmarks WHERE type = 2").all(),
			db.query<ZenRow, []>("SELECT b.guid, b.parent, p.url, COALESCE(NULLIF(b.title, ''), p.title) AS title, b.dateAdded FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1").all(),
		),
	);
}

/** The x.com sign-in Zen holds: the two cookies a request to X's API needs. Never logged or kept. */
export interface XCookies {
	authToken: string;
	ct0: string;
}

/** The x.com sign-in in the profile `profileDir`, each cookie's newest, or `null` when Zen holds none. */
export function readXCookies(profileDir: string): XCookies | null {
	const cookies = join(profileDir, "cookies.sqlite");
	if (!existsSync(cookies)) return null;
	const rows = withSnapshot(cookies, db =>
		db
			.query<{ name: string; value: string }, []>(
				"SELECT name, value FROM moz_cookies WHERE host IN ('.x.com', 'x.com') AND name IN ('auth_token', 'ct0') ORDER BY lastAccessed",
			)
			.all(),
	);
	const newest = Object.fromEntries(rows.map(({ name, value }) => [name, value]));
	return newest.auth_token && newest.ct0 ? { authToken: newest.auth_token, ct0: newest.ct0 } : null;
}

/** The bearer token x.com's own web page sends, the same for every visitor. */
const WEB_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0";
const CLIENT_WEB = "https://abs.twimg.com/responsive-web/client-web";
const PAGE_SIZE = 100;
/** The most posts one sync reads, so a sync of a huge list still ends. */
export const MAX_X_BOOKMARKS = 2000;

/** Why a sync failed, in words for the page. */
export class XSyncError extends Error {}

const NOT_SIGNED_IN = "Zen holds no x.com sign-in. Sign in to x.com in Zen, then sync again.";
const REFUSED = "X refused the request. Sign in to x.com in Zen again, then sync again.";
const CHANGED = "X changed its page, so the bookmarks could not be read.";

/** The `Bookmarks` query as x.com's page runs it now: its id, its feature switches with the page's values, and its field toggles. */
export interface BookmarksQuery {
	queryId: string;
	features: Record<string, boolean>;
	fieldToggles: Record<string, boolean>;
}

const OPERATION = /queryId:"([^"]+)",operationName:"Bookmarks",operationType:"query",metadata:\{featureSwitches:\[([^\]]*)\],fieldToggles:\[([^\]]*)\]/;

const names = (list: string): string[] => [...list.matchAll(/"([^"]+)"/g)].map(match => match[1] as string);

/** The `Bookmarks` query in `script`, one of the page's code chunks, with each feature's value from the page `html`; `null` when the chunk has none. */
export function bookmarksQueryIn(html: string, script: string): BookmarksQuery | null {
	const found = OPERATION.exec(script);
	if (!found) return null;
	const [, queryId, features, toggles] = found as unknown as [string, string, string, string];
	const valueOf = (name: string): boolean => new RegExp(`"${name.replace(/[^\w]/g, "")}":\\{"value":true\\b`).test(html);
	return {
		queryId,
		features: Object.fromEntries(names(features).map(name => [name, valueOf(name)])),
		fieldToggles: Object.fromEntries(names(toggles).map(name => [name, false])),
	};
}

/** The URLs of the page's code chunks whose names hold `Bookmarks`, from its chunk-name and chunk-hash maps. */
export function bookmarkChunks(html: string): string[] {
	const hashes = new Map([...html.matchAll(/(\d+):"([0-9a-f]{16})"/g)].map(([, id, hash]) => [id, hash]));
	return [...html.matchAll(/(\d+):"([\w.~-]*Bookmarks[\w.~-]*)"/g)].flatMap(([, id, name]) => {
		const hash = hashes.get(id as string);
		return hash ? [`${CLIENT_WEB}/${name}.${hash}a.js`] : [];
	});
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function headersFor({ authToken, ct0 }: XCookies): Record<string, string> {
	return {
		authorization: `Bearer ${WEB_BEARER}`,
		"x-csrf-token": ct0,
		cookie: `auth_token=${authToken}; ct0=${ct0}`,
		"x-twitter-active-user": "yes",
		"x-twitter-auth-type": "OAuth2Session",
		"user-agent": USER_AGENT,
	};
}

async function fetched(fetch: Fetch, url: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch {
		throw new XSyncError("X did not answer. Check the connection, then sync again.");
	}
}

function refusal(status: number): XSyncError {
	if (status === 401 || status === 403) return new XSyncError(REFUSED);
	if (status === 429) return new XSyncError("X limits how often bookmarks are read. Try again in a few minutes.");
	return new XSyncError(`X answered with an error (${status}). Try again later.`);
}

/** Reads x.com's page and its bookmark chunks for the `Bookmarks` query it runs today. */
async function discoverQuery(fetch: Fetch, cookies: XCookies): Promise<BookmarksQuery> {
	const page = await fetched(fetch, "https://x.com/home", { headers: { cookie: headersFor(cookies).cookie, "user-agent": USER_AGENT } });
	if (!page.ok) throw refusal(page.status);
	const html = await page.text();
	for (const url of bookmarkChunks(html)) {
		const chunk = await fetched(fetch, url);
		if (!chunk.ok) continue;
		const query = bookmarksQueryIn(html, await chunk.text());
		if (query) return query;
	}
	throw new XSyncError(CHANGED);
}

const pick = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((at, key) => (isObject(at) ? at[key] : undefined), value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** One timeline entry's post as a bookmark, with the character references X escapes in its author's name and text decoded, or `null` for a cursor, a removed post, or one X sent without its author. */
function postOf(entry: unknown): Bookmark | null {
	let result = pick(entry, "content", "itemContent", "tweet_results", "result");
	if (pick(result, "__typename") === "TweetWithVisibilityResults") result = pick(result, "tweet");
	const id = text(pick(result, "rest_id"));
	const user = pick(result, "core", "user_results", "result");
	const handle = text(pick(user, "core", "screen_name")) ?? text(pick(user, "legacy", "screen_name"));
	if (!id || !handle) return null;
	const name = decodeEntities(text(pick(user, "core", "name")) ?? text(pick(user, "legacy", "name")) ?? handle);
	const body = decodeEntities(text(pick(result, "note_tweet", "note_tweet_results", "result", "text")) ?? text(pick(result, "legacy", "full_text")) ?? "");
	const posted = Date.parse(text(pick(result, "legacy", "created_at")) ?? "");
	return {
		id: `x:${id}`,
		source: "x",
		url: `https://x.com/${handle}/status/${id}`,
		title: name,
		folder: null,
		text: body,
		author: `@${handle}`,
		addedAt: new Date(Number.isNaN(posted) ? 0 : posted).toISOString(),
	};
}

/** One page of the `Bookmarks` answer: its posts, and the cursor of the next page, `null` at the end; `null` when the answer is not the shape X sends. */
export function xBookmarksPage(answer: unknown): { bookmarks: Bookmark[]; cursor: string | null } | null {
	const instructions = pick(answer, "data", "bookmark_timeline_v2", "timeline", "instructions");
	if (!Array.isArray(instructions)) return null;
	const entries = instructions.flatMap(instruction => {
		const list = pick(instruction, "entries");
		return Array.isArray(list) ? list : [];
	});
	const bookmarks = entries.flatMap(entry => postOf(entry) ?? []);
	const bottom = entries.find(entry => pick(entry, "content", "cursorType") === "Bottom");
	return { bookmarks, cursor: text(pick(bottom, "content", "value")) };
}

/** Every post you bookmarked on x.com, newest bookmark first, up to {@link MAX_X_BOOKMARKS}; throws an {@link XSyncError}. */
export async function fetchXBookmarks(fetch: Fetch, cookies: XCookies): Promise<Bookmark[]> {
	const { queryId, features, fieldToggles } = await discoverQuery(fetch, cookies);
	const posts = new Map<string, Bookmark>();
	let cursor: string | null = null;
	while (posts.size < MAX_X_BOOKMARKS) {
		const variables = { count: PAGE_SIZE, includePromotedContent: false, ...(cursor && { cursor }) };
		const query = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(features), fieldToggles: JSON.stringify(fieldToggles) });
		const res = await fetched(fetch, `https://x.com/i/api/graphql/${queryId}/Bookmarks?${query}`, { headers: { ...headersFor(cookies), "content-type": "application/json" } });
		if (!res.ok) throw refusal(res.status);
		const page = xBookmarksPage(parseJson(await res.text()));
		if (!page) throw new XSyncError(CHANGED);
		const before = posts.size;
		for (const post of page.bookmarks) if (!posts.has(post.id)) posts.set(post.id, post);
		if (!page.cursor || page.cursor === cursor || posts.size === before) break;
		cursor = page.cursor;
	}
	return [...posts.values()].slice(0, MAX_X_BOOKMARKS);
}

/** What `bookmarks-x.json` keeps: the posts of the last sync that succeeded, when it ran, and why the last sync failed. */
export interface XFile {
	bookmarks: Bookmark[];
	syncedAt: string | null;
	error: string | null;
}

const NO_X: XFile = { bookmarks: [], syncedAt: null, error: null };

const isBookmark = (value: unknown): value is Bookmark =>
	isObject(value) && typeof value.id === "string" && (value.source === "zen" || value.source === "x") && typeof value.url === "string" && typeof value.title === "string" && typeof value.addedAt === "string";

/** The file at `path`, or no posts when it is missing or unreadable. */
export function readXFile(path: string): XFile {
	let raw: unknown;
	try {
		raw = parseJson(readFileSync(path, "utf8"));
	} catch {
		return NO_X;
	}
	if (!isObject(raw) || !Array.isArray(raw.bookmarks)) return NO_X;
	return {
		bookmarks: raw.bookmarks.filter(isBookmark),
		syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : null,
		error: typeof raw.error === "string" ? raw.error : null,
	};
}

/** Newest first. */
const newestFirst = (a: Bookmark, b: Bookmark): number => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0);

/** What the Memory module's bookmarks read: Zen's profile directory, found when each read runs, the X file, and the network. */
export interface BookmarksEnv {
	profileDir: () => string | null;
	xFile: string;
	fetch: Fetch;
	now?: () => Date;
}

/** Every bookmark, Zen's read from its profile now and the posts of the last X sync, newest first. */
export function readBookmarks(profileDir: string | null, xFile: string): { bookmarks: Bookmark[]; zenFound: boolean; x: XFile } {
	const zen = profileDir ? readZenBookmarks(profileDir) : null;
	const x = readXFile(xFile);
	return { bookmarks: [...(zen ?? []), ...x.bookmarks].sort(newestFirst), zenFound: zen !== null, x };
}

/** The Memory page's bookmarks, and the X sync, one at a time. */
export class Bookmarks {
	#syncing: Promise<BookmarksView> | null = null;

	constructor(private readonly env: BookmarksEnv) {}

	view(): BookmarksView {
		const profile = this.env.profileDir();
		const { bookmarks, zenFound, x } = readBookmarks(profile, this.env.xFile);
		const signedIn = profile !== null && readXCookies(profile) !== null;
		const state: XSyncState = { syncedAt: x.syncedAt, error: x.error, signedIn };
		return { bookmarks, zenFound, x: state };
	}

	/** Reads the x.com bookmarks again and keeps them, or keeps the last ones with why this sync failed; a sync already under way is the one answered. */
	syncX(): Promise<BookmarksView> {
		this.#syncing ??= this.#sync().finally(() => {
			this.#syncing = null;
		});
		return this.#syncing;
	}

	async #sync(): Promise<BookmarksView> {
		const last = readXFile(this.env.xFile);
		let next: XFile;
		try {
			const profile = this.env.profileDir();
			const cookies = profile && readXCookies(profile);
			if (!cookies) throw new XSyncError(NOT_SIGNED_IN);
			next = { bookmarks: await fetchXBookmarks(this.env.fetch, cookies), syncedAt: (this.env.now?.() ?? new Date()).toISOString(), error: null };
		} catch (error) {
			if (!(error instanceof XSyncError)) throw error;
			next = { ...last, error: error.message };
		}
		mkdirSync(dirname(this.env.xFile), { recursive: true });
		await atomicWriteText(this.env.xFile, `${JSON.stringify(next)}\n`);
		return this.view();
	}
}

/** What the `bookmarks` tool searches: a query whose every word must appear, one source, and how many to return. */
export interface BookmarkSearch {
	query?: string;
	source?: BookmarkSource;
	limit?: number;
}

export const DEFAULT_SEARCH_LIMIT = 20;

/** The bookmarks whose title, URL, folder, text, or author holds every word of `query`, case-insensitively, newest first. */
export function searchBookmarks(bookmarks: readonly Bookmark[], { query, source, limit = DEFAULT_SEARCH_LIMIT }: BookmarkSearch): Bookmark[] {
	const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	return bookmarks
		.filter(bookmark => source === undefined || bookmark.source === source)
		.filter(({ title, url, folder, text, author }) => {
			const haystack = [title, url, folder, text, author].filter(Boolean).join("\n").toLowerCase();
			return words.every(word => haystack.includes(word));
		})
		.sort(newestFirst)
		.slice(0, limit);
}

const oneLine = (value: string, max: number): string => {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** One bookmark as one compact line: the day, the source, where it sits or who posted it, what it says, and its URL. */
export function bookmarkLine({ source, addedAt, title, folder, text, author, url }: Bookmark): string {
	const day = addedAt.slice(0, 10);
	if (source === "x") return `${day} [x] ${author ?? title}: ${oneLine(text ?? "", 240)} ${url}`;
	return `${day} [zen]${folder ? ` ${folder} ·` : ""} ${oneLine(title, 160)} ${url}`;
}
