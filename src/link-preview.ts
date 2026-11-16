/**
 * The title, description, and site name of a public web page, for the card the page shows over a link.
 * The server reads the page, so no third party learns which links you point at, through the same public-HTTPS-only fetch as the favicons.
 */
import type { LinkPreview } from "./shared/link-preview";
import { dailyCache, fetchPublic, MAX_PAGE_BYTES } from "./favicon";

const META_TAG = /<meta\b[^>]*>/gi;
const TITLE_TAG = /<title\b[^>]*>([^<]*)<\/title>/i;
const MAX_TEXT = 300;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `text` with its character references decoded and its whitespace collapsed, at most 300 characters; `null` when blank. */
function plain(text: string | undefined): string | null {
	const decoded = text
		?.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
			if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? match;
			const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		})
		.replace(/\s+/g, " ")
		.trim();
	return decoded ? decoded.slice(0, MAX_TEXT) : null;
}

/** The value of attribute `name` in `tag`, quoted or bare. */
function attribute(tag: string, name: string): string | undefined {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/** What `html`'s `<head>` says about the page, or `null` when it names no title. */
export function previewOf(html: string): LinkPreview | null {
	const meta = new Map<string, string>();
	for (const [tag] of html.matchAll(META_TAG)) {
		const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
		const content = attribute(tag, "content");
		if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
	}
	const title = plain(meta.get("og:title") ?? meta.get("twitter:title")) ?? plain(TITLE_TAG.exec(html)?.[1]);
	if (!title) return null;
	return { title, description: plain(meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description")), site: plain(meta.get("og:site_name")) };
}

const previewAt = dailyCache(async (href, signal) => {
	const page = await fetchPublic(new URL(href), /^text\/html$/, MAX_PAGE_BYTES, signal, true);
	return page ? previewOf(await page.body.text()) : null;
});

/** `GET /api/link-preview?url=`: the {@link LinkPreview} of public HTTPS page `url`, or `null` when it is not one or names no title. */
export async function readLinkPreview(url: string | null): Promise<Response> {
	const parsed = url ? URL.parse(url) : null;
	if (parsed) parsed.hash = "";
	const preview = parsed?.protocol === "https:" ? await previewAt(parsed.href) : null;
	return Response.json(preview, { headers: { "Cache-Control": "private, max-age=86400" } });
}
