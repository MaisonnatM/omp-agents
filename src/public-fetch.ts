/**
 * Reads the server makes of web sites on the public internet, for the site icons and the link preview card: HTTPS only,
 * without ports or credentials, each host and redirect hop resolving to public addresses only, so a page cannot steer
 * a read at this computer or its network, and each answer capped in size.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** How long a caller gives one read, redirects included, through the signal it passes. */
export const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 256 * 1024;
/** Enough of a page for its `<head>`. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 256;
const REDIRECTS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };
/** A host name a site on the public internet can have: dotted labels, no IP literal, nothing local. */
const PUBLIC_HOST = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/;
const LOCAL_SUFFIX = /\.(?:local|localhost|internal|lan|home|arpa)$/;
const CHARSET = /;\s*charset\s*=\s*["']?([^"';\s]+)/i;
/** What a read asks for: the `Accept` header it sends and the content types it takes. */
interface Wanted {
	accept: string;
	type: RegExp;
}
const IMAGE: Wanted = { accept: "image/*", type: /^image\/[a-z\d.+-]+$/ };
const HTML: Wanted = { accept: "text/html", type: /^text\/html$/ };

/**
 * `load` remembered for a day per key, up to 256 keys, the oldest dropped first; a miss or a failure is kept as `null` too,
 * so a key is asked once a day, and concurrent asks for one key share one load. `load` bounds its own time.
 * The cache is its own map because it keeps misses and bounds its entries, which `createCache` in `cache.ts` does not.
 */
export function dailyCache<T>(load: (key: string) => Promise<T | null>): (key: string) => Promise<T | null> {
	const cache = new Map<string, { at: number; value: Promise<T | null> }>();
	return key => {
		const now = Date.now();
		let entry = cache.get(key);
		if (!entry || now - entry.at >= CACHE_TTL_MS) {
			entry = { at: now, value: load(key).catch(() => null) };
			cache.delete(key);
			cache.set(key, entry);
			if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
		}
		return entry.value;
	};
}

/** Whether `address` is an IPv4 or IPv6 address only this computer or its network reaches. */
function privateAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const [a, b] = address.split(".").map(Number) as [number, number];
		return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
	}
	const v6 = address.toLowerCase();
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
	if (mapped) return privateAddress(mapped[1]!);
	return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

/** `host` lowercased when a site on the public internet can have that name, checked without asking DNS; `null` otherwise. */
export function publicName(host: string): string | null {
	const name = host.toLowerCase();
	return PUBLIC_HOST.test(name) && !LOCAL_SUFFIX.test(name) ? name : null;
}

/** `host` lowercased when it is a public name every address of which is public; `null` otherwise. */
async function publicHost(host: string): Promise<string | null> {
	const name = publicName(host);
	if (!name) return null;
	const addresses = await lookup(name, { all: true }).catch(() => []);
	return addresses.length > 0 && !addresses.some(({ address }) => privateAddress(address)) ? name : null;
}

/** The OK response of `url` whose content type `wanted` takes, following redirects to public HTTPS hosts; `null` otherwise. */
async function openPublic(url: URL, wanted: Wanted, signal: AbortSignal): Promise<{ url: URL; response: Response; type: string } | null> {
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (url.protocol !== "https:" || url.port || url.username || url.password || !(await publicHost(url.hostname))) return null;
		const response = await fetch(url.href, { redirect: "manual", signal, headers: { Accept: wanted.accept } });
		if (REDIRECTS[response.status]) {
			await response.body?.cancel();
			const location = response.headers.get("location");
			const next = location ? URL.parse(location, url) : null;
			if (!next) return null;
			url = next;
			continue;
		}
		const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		if (response.ok && wanted.type.test(type)) return { url, response, type };
		await response.body?.cancel();
		return null;
	}
	return null;
}

/** The image at public HTTPS address `url`, or `null` when it is not one, is empty, or is over 256 KiB. */
export async function readPublicImage(url: URL, signal: AbortSignal): Promise<Blob | null> {
	const opened = await openPublic(url, IMAGE, signal);
	if (!opened) return null;
	const { response, type } = opened;
	if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
		await response.body?.cancel();
		return null;
	}
	const chunks: BlobPart[] = [];
	let size = 0;
	for await (const chunk of response.body ?? []) {
		size += chunk.byteLength;
		if (size > MAX_IMAGE_BYTES) return null;
		chunks.push(chunk);
	}
	return size === 0 ? null : new Blob(chunks, { type });
}

/**
 * The first 512 KiB of the HTML page at public HTTPS address `url`, enough for its `<head>`, decoded with the charset
 * its response names, else UTF-8, and the address it was read from after redirects; `null` when it is not a page or is empty.
 */
export async function readPublicHead(url: URL, signal: AbortSignal): Promise<{ url: URL; html: string } | null> {
	const opened = await openPublic(url, HTML, signal);
	if (!opened) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of opened.response.body ?? []) {
		const kept = chunk.subarray(0, MAX_PAGE_BYTES - size);
		chunks.push(kept);
		size += kept.byteLength;
		if (size === MAX_PAGE_BYTES) break;
	}
	if (size === 0) return null;
	return { url: opened.url, html: decoderOf(opened.response.headers.get("content-type")).decode(Buffer.concat(chunks, size)) };
}

/** A decoder for the charset `contentType` names, or UTF-8 when it names none or one this runtime does not know. */
function decoderOf(contentType: string | null): TextDecoder {
	const charset = (contentType && CHARSET.exec(contentType)?.[1]) || "utf-8";
	try {
		return new TextDecoder(charset);
	} catch {
		return new TextDecoder();
	}
}
