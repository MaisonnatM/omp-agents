import { expect, test } from "bun:test";
import { mailDocument } from "./mail-document";

test("a message's HTML is served as its own document, under a policy that runs nothing and loads only images, styles, and fonts, with no referrer", async () => {
	const response = mailDocument("<p>Hi</p>");
	expect(response.status).toBe(200);
	expect(Object.fromEntries(response.headers)).toEqual({
		"content-type": "text/html; charset=utf-8",
		"content-security-policy": "sandbox allow-same-origin; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		"cache-control": "private, no-store",
	});
	expect(await response.text()).toBe(
		`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>:root{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#1f1f1f;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{white-space:pre-wrap}</style></head><body><p>Hi</p></body></html>`,
	);
});
