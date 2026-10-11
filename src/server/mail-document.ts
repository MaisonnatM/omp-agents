/**
 * A Gmail message's HTML as a document of its own, which the Inbox page frames by its address. A frame's `srcdoc` would
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

/** The document a message's HTML renders in, as the response serving it; its head comes first, so the message's own markup cannot precede it. */
export function mailDocument(html: string): Response {
	const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>${MAIL_STYLE}</style></head><body>${html}</body></html>`;
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
