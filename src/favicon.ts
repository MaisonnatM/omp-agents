/**
 * The icons of the web sites the Todos card's Sources section lists, fetched by the server so the page's policy can
 * keep refusing outside images and no third-party icon service learns which sites a session opened.
 * A site's icon is its `/favicon.ico`, else the first icon its home page links; only public HTTPS hosts are asked.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_ICON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 256;
const REDIRECTS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };
/** A host name a site on the public internet can have: dotted labels, no IP literal, nothing local. */
const PUBLIC_HOST = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/;
const LOCAL_SUFFIX = /\.(?:local|localhost|internal|lan|home|arpa)$/;
/** Each `<link>` tag of a page, whose `rel` and `href` the reader takes apart. */
const LINK_TAG = /<link\b[^>]*>/gi;
/** A host's icon, or `null` when it has none; misses are kept too, so a site without one is asked once a day. */
const cache = new Map<string, { at: number; icon: Blob | null }>();

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

/** `host` lowercased when it is a public name every address of which is public; `null` otherwise. */
async function publicHost(host: string): Promise<string | null> {
	const name = host.toLowerCase();
	if (!PUBLIC_HOST.test(name) || LOCAL_SUFFIX.test(name)) return null;
	const addresses = await lookup(name, { all: true }).catch(() => []);
	return addresses.length > 0 && !addresses.some(({ address }) => privateAddress(address)) ? name : null;
}

/** The body of `url` when it answers OK with a type `accept` takes and at most `limit` bytes, following redirects to public HTTPS hosts; `null` otherwise. */
async function fetchPublic(url: URL, accept: RegExp, limit: number, signal: AbortSignal): Promise<{ url: URL; body: Blob } | null> {
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (url.protocol !== "https:" || url.port || url.username || url.password || !(await publicHost(url.hostname))) return null;
		const response = await fetch(url.href, { redirect: "manual", signal, headers: { Accept: "image/*, text/html;q=0.5" } });
		if (REDIRECTS[response.status]) {
			await response.body?.cancel();
			const location = response.headers.get("location");
			const next = location ? URL.parse(location, url) : null;
			if (!next) return null;
			url = next;
			continue;
		}
		const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		if (!response.ok || !accept.test(type) || Number(response.headers.get("content-length")) > limit) {
			await response.body?.cancel();
			return null;
		}
		const chunks: BlobPart[] = [];
		let size = 0;
		for await (const chunk of response.body ?? []) {
			size += chunk.byteLength;
			if (size > limit) return null;
			chunks.push(chunk);
		}
		return size === 0 ? null : { url, body: new Blob(chunks, { type }) };
	}
	return null;
}

/** The address of the first icon `html`, served from `base`, links, preferring one that is not an Apple touch icon. */
function linkedIcon(html: string, base: URL): URL | null {
	const icons = [...html.matchAll(LINK_TAG)].flatMap(([tag]) => {
		const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
		const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
		const url = href && rel.split(/\s+/).some(word => word === "icon" || word === "apple-touch-icon") ? URL.parse(href.replaceAll("&amp;", "&"), base) : null;
		return url ? [{ url, touch: rel.includes("apple-touch-icon") }] : [];
	});
	return (icons.find(icon => !icon.touch) ?? icons[0])?.url ?? null;
}

async function fetchIcon(host: string, signal: AbortSignal): Promise<Blob | null> {
	const icon = /^image\/[a-z\d.+-]+$/;
	const direct = await fetchPublic(new URL(`https://${host}/favicon.ico`), icon, MAX_ICON_BYTES, signal);
	if (direct) return direct.body;
	const page = await fetchPublic(new URL(`https://${host}/`), /^text\/html$/, MAX_PAGE_BYTES, signal);
	const linked = page && linkedIcon(await page.body.text(), page.url);
	return linked ? ((await fetchPublic(linked, icon, MAX_ICON_BYTES, signal))?.body ?? null) : null;
}

/** `GET /api/favicon?host=`: the icon of public site `host`, or 404 when it has none or is not public; upstream headers never cross. */
export async function readFavicon(host: string | null): Promise<Response> {
	const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
	const name = host?.toLowerCase() ?? "";
	if (!PUBLIC_HOST.test(name) || LOCAL_SUFFIX.test(name)) return missing();
	const now = Date.now();
	let entry = cache.get(name);
	if (!entry || now - entry.at >= CACHE_TTL_MS) {
		const icon = await fetchIcon(name, AbortSignal.timeout(TIMEOUT_MS)).catch(() => null);
		entry = { at: now, icon };
		cache.delete(name);
		cache.set(name, entry);
		if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
	}
	if (!entry.icon) return missing();
	return new Response(entry.icon, {
		headers: {
			// An icon that claims to be SVG still draws only as an image here: the sandbox keeps any script in it from running.
			"Content-Type": entry.icon.type,
			"Cache-Control": "private, max-age=86400",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "sandbox; default-src 'none'",
		},
	});
}
