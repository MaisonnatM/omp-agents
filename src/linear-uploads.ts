/**
 * The files that Linear issues embed. Linear hands them out as `uploads.linear.app` addresses signed for five minutes,
 * so the page loads each through this server, which keeps the latest signed address and asks Linear for a new one once
 * it expires: a video still plays, and seeks, long after the sheet opened.
 */
import { TICKET_MEDIA_PATH } from "./shared";

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

/** The latest signed address of each upload path. */
const signed = new Map<string, { url: string; expiresAt: number }>();

/** When the `signature` JWT of a signed address expires, in ms since the epoch. */
function expiryOf(url: URL): number {
	const payload = url.searchParams.get("signature")?.split(".")[1];
	try {
		const exp: unknown = payload ? JSON.parse(Buffer.from(payload, "base64url").toString()).exp : undefined;
		if (typeof exp === "number") return exp * 1000;
	} catch {}
	return Date.now() + DEFAULT_TTL_MS;
}

/**
 * The address the page loads `address` from: for one of Linear's uploads, this server's media route, which remembers
 * the signed address; any other address unchanged.
 */
export function uploadAddress(issue: string, address: string): string {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return address;
	}
	if (url.host !== HOST || !UPLOAD_PATH.test(url.pathname)) return address;
	const now = Date.now();
	for (const [path, entry] of signed) if (entry.expiresAt <= now) signed.delete(path);
	signed.set(url.pathname, { url: url.href, expiresAt: expiryOf(url) });
	return `${TICKET_MEDIA_PATH}?${new URLSearchParams({ issue, path: url.pathname })}`;
}

export const isUploadPath = (path: string): boolean => UPLOAD_PATH.test(path);

function current(path: string): string | undefined {
	const entry = signed.get(path);
	return entry && entry.expiresAt - MARGIN_MS > Date.now() ? entry.url : undefined;
}

/**
 * Upload `path` as Linear serves it, the `range` header passed on, or `null` when no read of its issue names it.
 * `refresh` reads the issue again, which signs its uploads anew; it runs when the kept address expired, or Linear
 * refused it.
 */
export async function serveUpload(path: string, range: string | null, signal: AbortSignal, refresh: () => Promise<unknown>): Promise<Response | null> {
	const read = (url: string) => fetch(url, { headers: range ? { range } : {}, signal });
	let url = current(path);
	if (!url) {
		await refresh();
		url = current(path);
	}
	if (!url) return null;
	let upstream = await read(url);
	if (upstream.status === 401 || upstream.status === 403) {
		signed.delete(path);
		await refresh();
		url = current(path);
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
