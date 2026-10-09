/**
 * The files that Linear issues embed. Linear hands them out as `uploads.linear.app` addresses signed for five minutes,
 * so the page loads each through this server, which keeps the latest signed address and asks Linear for a new one once
 * it expires: a video still plays, and seeks, long after the sheet opened. An address is kept under the issue whose
 * text named it, and served only for that issue.
 */
import { TICKET_MEDIA_PATH } from "./shared/tickets";

const HOST = "uploads.linear.app";
/** A signed address this close to its expiry counts as expired, so a long read does not start on one about to lapse. */
const MARGIN_MS = 30_000;
/** How long an address with no readable expiry is trusted: under Linear's five minutes. */
const DEFAULT_TTL_MS = 4 * 60_000;
/** An upload's path: Linear's ids, slash-separated. */
const UPLOAD_PATH = /^(?:\/[\w-]+){1,8}$/;
/** The upstream headers a ranged media read needs. */
const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];
/** Types that render inside the page; anything else downloads. */
const INLINE_TYPE = /^(?:image\/(?:png|jpe?g|gif|webp|avif)|video\/|audio\/)/i;

/** Most signed addresses kept; past it the oldest goes, since signing one anew costs one read of its issue. */
const MAX_SIGNED = 256;

/** The latest signed address of each upload path, by the issue whose text named it. */
const signed = new Map<string, { url: string; expiresAt: number }>();

/** The key of upload `path` of issue `issue`; a newline is in neither. */
const keyOf = (issue: string, path: string): string => `${issue}\n${path}`;

/** When the `signature` JWT of a signed address expires, in ms since the epoch. */
function expiryOf(url: URL): number {
	const payload = url.searchParams.get("signature")?.split(".")[1];
	try {
		const exp: unknown = payload ? JSON.parse(Buffer.from(payload, "base64url").toString()).exp : undefined;
		if (typeof exp === "number") return exp * 1000;
	} catch {}
	return Date.now() + DEFAULT_TTL_MS;
}

/** Every Linear upload address in a text; it stops at a quote, a bracket, or a backslash, so it also reads raw tool JSON. */
const UPLOAD_URL = /https:\/\/uploads\.linear\.app\/[^\s"'<>()[\]\\]+/g;

/** `address` as a URL when it is one of Linear's uploads. */
function uploadUrl(address: string): URL | null {
	try {
		const url = new URL(address);
		return url.host === HOST && UPLOAD_PATH.test(url.pathname) ? url : null;
	} catch {
		return null;
	}
}

/** `text` with each of Linear's upload addresses made this server's media route for issue `issue`; the rest unchanged. */
export const proxyUploads = (issue: string, text: string): string =>
	text.replace(UPLOAD_URL, address => {
		const url = uploadUrl(address);
		return url ? `${TICKET_MEDIA_PATH}?${new URLSearchParams({ issue, path: url.pathname })}` : address;
	});

/** Keeps the signed address of each upload in `texts`, the raw answers of Linear's tools about issue `issue`, for the media route to fetch. */
export function rememberUploads(issue: string, ...texts: string[]): void {
	const now = Date.now();
	for (const [key, entry] of signed) if (entry.expiresAt <= now) signed.delete(key);
	for (const text of texts) {
		for (const [address] of text.matchAll(UPLOAD_URL)) {
			const url = uploadUrl(address);
			if (!url) continue;
			const key = keyOf(issue, url.pathname);
			// Deleting first moves the key to the end of the map's order, which is the order of eviction.
			signed.delete(key);
			signed.set(key, { url: url.href, expiresAt: expiryOf(url) });
		}
	}
	for (const key of signed.keys()) {
		if (signed.size <= MAX_SIGNED) break;
		signed.delete(key);
	}
}

export const isUploadPath = (path: string): boolean => UPLOAD_PATH.test(path);

/** The kept address of upload `key` while it is good for a read; an expired one is dropped. */
function current(key: string): string | undefined {
	const entry = signed.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt - MARGIN_MS > Date.now()) return entry.url;
	signed.delete(key);
	return undefined;
}

/**
 * Upload `path` of issue `issue` as Linear serves it, the `range` header passed on, or `null` when no read of that issue
 * names it. `refresh` reads the issue again and `rememberUploads` its answers, which signs its uploads anew; it runs when
 * the kept address expired, or Linear refused it.
 */
export async function serveUpload(issue: string, path: string, range: string | null, signal: AbortSignal, refresh: () => Promise<void>): Promise<Response | null> {
	const key = keyOf(issue, path);
	const read = (url: string) => fetch(url, { headers: range ? { range } : {}, signal });
	let url = current(key);
	if (!url) {
		await refresh();
		url = current(key);
	}
	if (!url) return null;
	let upstream = await read(url);
	if (upstream.status === 401 || upstream.status === 403) {
		signed.delete(key);
		await refresh();
		url = current(key);
		if (!url) return null;
		upstream = await read(url);
	}
	const headers = new Headers();
	for (const name of PASSED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	if (!INLINE_TYPE.test(headers.get("content-type") ?? "")) headers.set("content-disposition", "attachment");
	// The file comes from whoever wrote the issue and is served from this origin: it must never run as a page here.
	headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
	headers.set("x-content-type-options", "nosniff");
	headers.set("cache-control", "private, max-age=3600");
	return new Response(upstream.body, { status: upstream.status, headers });
}
