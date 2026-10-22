/**
 * GitHub-hosted images and videos, with credentials kept on github.com across manually checked redirects.
 * The cache is its own map because it bounds the bytes it holds, which `createCache` in `cache.ts` does not.
 */
import { runChecked } from "./proc";
import { githubMediaUrl } from "./shared/github";

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 32;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TOKEN_TTL_MS = 60_000;
const REDIRECTS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };
const cache = new Map<string, { at: number; body: Blob }>();
let cacheBytes = 0;
let tokenRead: { at: number; token: string } | null = null;

/** GitHub answers a token's upload request with a signed link into this bucket, which only a hop from github.com may reach. */
const UPLOAD_BUCKET = "github-production-user-asset-6210df.s3.amazonaws.com";

class MediaRefused extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

function mediaUrl(raw: string): URL {
	const url = githubMediaUrl(raw);
	if (!url) throw new MediaRefused(400, "Expected an HTTPS GitHub media URL");
	return url;
}

function redirectTarget(location: string, from: URL): URL {
	const url = new URL(location, from);
	const bucket = from.hostname === "github.com" && url.hostname === UPLOAD_BUCKET && url.protocol === "https:" && !url.username && !url.password && !url.port;
	return bucket ? url : mediaUrl(url.href);
}

function drop(key: string): void {
	const entry = cache.get(key);
	if (entry) cacheBytes -= entry.body.size;
	cache.delete(key);
}

function keep(key: string, body: Blob): void {
	drop(key);
	while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + body.size > MAX_CACHE_BYTES) drop(cache.keys().next().value!);
	cache.set(key, { at: Date.now(), body });
	cacheBytes += body.size;
}

/** The github.com token, read at most once a minute, since one pull request body can hold dozens of uploads. */
async function githubToken(signal: AbortSignal): Promise<string> {
	const now = Date.now();
	if (tokenRead && now - tokenRead.at < TOKEN_TTL_MS) return tokenRead.token;
	const token = (await runChecked(["gh", "auth", "token", "--hostname", "github.com"], { timeoutMs: TIMEOUT_MS, signal })).trim();
	tokenRead = { at: now, token };
	return token;
}

async function fetchMedia(url: URL, signal: AbortSignal): Promise<Blob> {
	let token: string | undefined;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const headers = new Headers({ Accept: "image/*, video/*" });
		if (url.hostname === "github.com") {
			token ??= await githubToken(signal);
			if (token) headers.set("Authorization", `Bearer ${token}`);
		}
		const response = await fetch(url.href, { headers, redirect: "manual", signal });
		if (REDIRECTS[response.status]) {
			await response.body?.cancel();
			const location = response.headers.get("location");
			if (!location || hop === MAX_REDIRECTS) throw new MediaRefused(502, "GitHub media redirected too many times or without a location");
			try {
				url = redirectTarget(location, url);
			} catch {
				throw new MediaRefused(502, "GitHub media redirected outside the allowed hosts");
			}
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new MediaRefused(response.status === 404 ? 404 : 502, "GitHub media could not be loaded");
		}
		const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		if (!/^(?:image|video)\/[a-z0-9.+-]+$/.test(type)) {
			await response.body?.cancel();
			throw new MediaRefused(415, "GitHub media must be an image or video");
		}
		if (Number(response.headers.get("content-length")) > MAX_BYTES) {
			await response.body?.cancel();
			throw new MediaRefused(413, "GitHub media exceeds 20 MiB");
		}
		const chunks: BlobPart[] = [];
		let size = 0;
		const reader = response.body?.getReader();
		if (reader) {
			try {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					size += chunk.value.byteLength;
					if (size > MAX_BYTES) {
						await reader.cancel();
						throw new MediaRefused(413, "GitHub media exceeds 20 MiB");
					}
					chunks.push(chunk.value);
				}
			} finally {
				reader.releaseLock();
			}
		}
		return new Blob(chunks, { type });
	}
	throw new MediaRefused(502, "GitHub media redirected too many times");
}

/** An authenticated dashboard read; upstream headers and cookies never cross this proxy. */
export async function readGithubMedia(raw: string | null): Promise<Response> {
	try {
		const url = mediaUrl(raw ?? "");
		const now = Date.now();
		for (const [key, entry] of cache) if (now - entry.at >= CACHE_TTL_MS) drop(key);
		let body = cache.get(url.href)?.body;
		if (!body) {
			body = await fetchMedia(url, AbortSignal.timeout(TIMEOUT_MS));
			keep(url.href, body);
		}
		return new Response(body, {
			headers: {
				"Content-Type": body.type,
				"Content-Length": String(body.size),
				"Cache-Control": "private, max-age=300",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "sandbox; default-src 'none'",
			},
		});
	} catch (err) {
		const status = err instanceof MediaRefused ? err.status : 502;
		const error = err instanceof MediaRefused ? err.message : "GitHub media could not be loaded";
		return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
	}
}
