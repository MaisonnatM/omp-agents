/**
 * The title, description, and site name of a public web page, for the card the page shows over a link.
 * The server reads the page, so no third party learns which links you point at, through the same public-HTTPS-only reads as the favicons.
 */
import { attribute, decodeEntities } from "./html-text";
import { dailyCache, FETCH_TIMEOUT_MS, readPublicHead } from "./public-fetch";
import type { LinkPreview } from "./shared/link-preview";

const META_TAG = /<meta\b[^>]*>/gi;
const TITLE_TAG = /<title\b[^>]*>([^<]*)<\/title>/i;
const MAX_TEXT = 300;

/** `text` with its whitespace collapsed, at most 300 characters; `null` when blank. */
function plain(text: string | undefined): string | null {
	const collapsed = text?.replace(/\s+/g, " ").trim();
	return collapsed ? collapsed.slice(0, MAX_TEXT) : null;
}

/** What `html`'s `<head>` says about the page, or `null` when it names no title. */
export function parsePreview(html: string): LinkPreview | null {
	const meta = new Map<string, string>();
	for (const [tag] of html.matchAll(META_TAG)) {
		const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
		const content = attribute(tag, "content");
		if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
	}
	const titleTag = TITLE_TAG.exec(html)?.[1];
	const title = plain(meta.get("og:title") ?? meta.get("twitter:title")) ?? plain(titleTag && decodeEntities(titleTag));
	if (!title) return null;
	return { title, description: plain(meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description")), site: plain(meta.get("og:site_name")) };
}

const previewAt = dailyCache(async href => {
	const page = await readPublicHead(new URL(href), AbortSignal.timeout(FETCH_TIMEOUT_MS));
	return page && parsePreview(page.html);
});

/**
 * `GET /api/link-preview?url=`: the {@link LinkPreview} of public HTTPS page `url`, or `null` when it is not one or names no title.
 * The browser keeps a preview for a day and a `null` for an hour, as it does a favicon's miss.
 */
export async function readLinkPreview(url: string | null): Promise<Response> {
	const parsed = url ? URL.parse(url) : null;
	if (parsed) parsed.hash = "";
	const preview = parsed?.protocol === "https:" ? await previewAt(parsed.href) : null;
	return Response.json(preview, { headers: { "Cache-Control": `private, max-age=${preview ? 86400 : 3600}` } });
}
