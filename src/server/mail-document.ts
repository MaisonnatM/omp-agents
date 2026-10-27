/**
 * A Gmail message's HTML as a document of its own, which the Email page frames by its address. A frame's `srcdoc` would
 * inherit the page's policy, whose `img-src` no message can widen, so its images would never load; this document
 * carries its own policy in a header instead.
 */

/**
 * What a message may load: images, styles, and fonts over HTTPS or inline, and nothing else. `sandbox` keeps its scripts,
 * forms, and popups off even when its address opens in a tab of its own, and `allow-same-origin` lets the page reach into
 * its frame to size it and pass its links and keys on.
 */
const MAIL_POLICY = "sandbox allow-same-origin; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:";

/** The look a message without styles of its own gets, on the white it was written for in either theme. */
const MAIL_STYLE =
	":root{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#1f1f1f;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{white-space:pre-wrap}";

/** The largest width and height, in CSS pixels, of an image that shows nothing and only reports that the message was opened. Google's own is 3×1. */
const PIXEL_PX = 3;

/** A length in CSS pixels, `"1"` or `"1px"` with any `!important`; `undefined` for any other unit, a percentage, or `auto`. */
function pixelsOf(value: string | null | undefined): number | undefined {
	const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*(?:!\s*important)?\s*$/i.exec(value ?? "");
	return match ? Number(match[1]) : undefined;
}

/** The smallest size `img` declares along one axis, from its attribute and its inline `width`/`max-width` (or `height`/`max-height`). */
function declaredSize(attribute: string | null, style: Map<string, string>, axis: "width" | "height"): number | undefined {
	const sizes = [pixelsOf(attribute), pixelsOf(style.get(axis)), pixelsOf(style.get(`max-${axis}`))].filter(size => size !== undefined);
	return sizes.length ? Math.min(...sizes) : undefined;
}

/** Whether `img` is a tracking pixel: it declares a width and a height, both at most {@link PIXEL_PX}. */
function isTrackingPixel(img: HTMLRewriterTypes.Element): boolean {
	const style = new Map(
		(img.getAttribute("style") ?? "").split(";").flatMap(declaration => {
			const colon = declaration.indexOf(":");
			return colon < 0 ? [] : [[declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1)] as const];
		}),
	);
	const width = declaredSize(img.getAttribute("width"), style, "width");
	const height = declaredSize(img.getAttribute("height"), style, "height");
	return width !== undefined && height !== undefined && width <= PIXEL_PX && height <= PIXEL_PX;
}

/** `html` without its tracking pixels, which tell the sender that, when, and from where the message was opened, and keep its frame loading while their server takes its time. */
const withoutTrackingPixels = (html: string): string =>
	new HTMLRewriter()
		.on("img", {
			element(img) {
				if (isTrackingPixel(img)) img.remove();
			},
		})
		.transform(html);

/** The document a message's HTML renders in, as the response serving it; its head comes first, so the message's own markup cannot precede it. */
export function mailDocument(html: string): Response {
	const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>${MAIL_STYLE}</style></head><body>${withoutTrackingPixels(html)}</body></html>`;
	return new Response(document, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy": MAIL_POLICY,
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
			"Cache-Control": "private, no-store",
		},
	});
}
