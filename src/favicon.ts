/**
 * The icons of the web sites the page names, such as the Overview tab's Sources and the link preview card, fetched by the
 * server so the page's policy can keep refusing outside images and no third-party icon service learns which sites a session opened.
 * A site's icon is its `/favicon.ico`, else the first icon its home page links; only public HTTPS hosts are asked, through `public-fetch.ts`.
 */
import { attribute } from "./html-text";
import { dailyCache, FETCH_TIMEOUT_MS, publicName, readPublicHead, readPublicImage } from "./public-fetch";

/** Each `<link>` tag of a page, whose `rel` and `href` the reader takes apart. */
const LINK_TAG = /<link\b[^>]*>/gi;

/** The address of the first icon `html`, served from `base`, links, preferring one that is not an Apple touch icon. */
function linkedIcon(html: string, base: URL): URL | null {
	const icons = [...html.matchAll(LINK_TAG)].flatMap(([tag]) => {
		const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
		const href = attribute(tag, "href");
		const url = href && rel.some(word => word === "icon" || word === "apple-touch-icon") ? URL.parse(href, base) : null;
		return url ? [{ url, touch: rel.includes("apple-touch-icon") }] : [];
	});
	return (icons.find(icon => !icon.touch) ?? icons[0])?.url ?? null;
}

const iconOf = dailyCache(async (host): Promise<Blob | null> => {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const direct = await readPublicImage(new URL(`https://${host}/favicon.ico`), signal);
	if (direct) return direct;
	const page = await readPublicHead(new URL(`https://${host}/`), signal);
	const linked = page && linkedIcon(page.html, page.url);
	return linked ? readPublicImage(linked, signal) : null;
});

/** `GET /api/favicon?host=`: the icon of public site `host`, or 404 when it has none or is not public; upstream headers never cross. */
export async function readFavicon(host: string | null): Promise<Response> {
	const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
	const name = host ? publicName(host) : null;
	const icon = name ? await iconOf(name) : null;
	if (!icon) return missing();
	return new Response(icon, {
		headers: {
			// An icon that claims to be SVG still draws only as an image here: the sandbox keeps any script in it from running.
			"Content-Type": icon.type,
			"Cache-Control": "private, max-age=86400",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "sandbox; default-src 'none'",
		},
	});
}
