/**
 * The X sync: the x.com posts you bookmarked, read through X's own `Bookmarks` query with the cookies of your
 * signed-in Zen session. See docs/architecture/memory-page.md.
 */
import { decodeEntities } from "../html-text";
import { isObject, parseJson } from "../json";
import type { XBookmark } from "../shared/memory-page";
import type { XCookies } from "./zen";

/** The bearer token x.com's own web page sends, the same for every visitor. */
const WEB_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0";
const CLIENT_WEB = "https://abs.twimg.com/responsive-web/client-web";
const PAGE_SIZE = 100;
/** The most posts one sync reads, so a sync of a huge list still ends. */
export const MAX_X_BOOKMARKS = 2000;

/** Why a sync failed, in words for the page. */
export class XSyncError extends Error {}

export const NOT_SIGNED_IN = "Zen holds no x.com sign-in. Sign in to x.com in Zen, then sync again.";
const REFUSED = "X refused the request. Sign in to x.com in Zen again, then sync again.";
const CHANGED = "X changed its page, so the bookmarks could not be read.";

/** The `Bookmarks` query as x.com's page runs it now: its id, its feature switches with the page's values, and its field toggles. */
export interface BookmarksQuery {
	queryId: string;
	features: Record<string, boolean>;
	fieldToggles: Record<string, boolean>;
}

const OPERATION =
	/queryId:"(?<queryId>[^"]+)",operationName:"Bookmarks",operationType:"query",metadata:\{featureSwitches:\[(?<features>[^\]]*)\],fieldToggles:\[(?<toggles>[^\]]*)\]/;

const names = (list: string): string[] => [...list.matchAll(/"([^"]+)"/g)].map(match => match[1] as string);

/** The `Bookmarks` query in `script`, one of the page's code chunks, with each feature's value from the page `html`; `null` when the chunk has none. */
export function bookmarksQueryIn(html: string, script: string): BookmarksQuery | null {
	const { queryId, features = "", toggles = "" } = OPERATION.exec(script)?.groups ?? {};
	if (!queryId) return null;
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

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

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
function postOf(entry: unknown): XBookmark | null {
	let result = pick(entry, "content", "itemContent", "tweet_results", "result");
	if (pick(result, "__typename") === "TweetWithVisibilityResults") result = pick(result, "tweet");
	const id = text(pick(result, "rest_id"));
	const user = pick(result, "core", "user_results", "result");
	const handle = text(pick(user, "core", "screen_name")) ?? text(pick(user, "legacy", "screen_name"));
	if (!id || !handle) return null;
	const posted = Date.parse(text(pick(result, "legacy", "created_at")) ?? "");
	return {
		source: "x",
		id: `x:${id}`,
		url: `https://x.com/${handle}/status/${id}`,
		name: decodeEntities(text(pick(user, "core", "name")) ?? text(pick(user, "legacy", "name")) ?? handle),
		handle: `@${handle}`,
		text: decodeEntities(text(pick(result, "note_tweet", "note_tweet_results", "result", "text")) ?? text(pick(result, "legacy", "full_text")) ?? ""),
		addedAt: new Date(Number.isNaN(posted) ? 0 : posted).toISOString(),
	};
}

/** One page of the `Bookmarks` answer: its posts, and the cursor of the next page, `null` at the end; `null` when the answer is not the shape X sends. */
export function xBookmarksPage(answer: unknown): { bookmarks: XBookmark[]; cursor: string | null } | null {
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
export async function fetchXBookmarks(fetch: Fetch, cookies: XCookies): Promise<XBookmark[]> {
	const { queryId, features, fieldToggles } = await discoverQuery(fetch, cookies);
	const posts = new Map<string, XBookmark>();
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
