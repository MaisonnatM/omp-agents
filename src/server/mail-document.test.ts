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

const bodyOf = async (html: string): Promise<string> => /<body>(.*)<\/body>/s.exec(await mailDocument(html).text())?.[1] ?? "";

test("an image no larger than 3×3 px by its attributes or inline style is dropped as a tracking pixel", async () => {
	const pixels = [
		`<img src="https://t.example/o.gif" width="1" height="1">`,
		`<img src="https://t.example/o.gif" width="3" height="1">`,
		`<img src="https://t.example/o.gif" style="display: none; width: 1px; height: 1px;">`,
		`<img src="https://t.example/o.gif" alt="" style="height: 1px !important; max-height: 1px !important; max-width: 1px !important; width: 1px !important;"/>`,
		`<img src="https://t.example/o.gif" width="600" style="max-width:1px;HEIGHT:0">`,
	];
	expect(await bodyOf(`<p>Hi</p>${pixels.join("")}<p>Bye</p>`)).toBe("<p>Hi</p><p>Bye</p>");
});

test("an image that declares one side only, a larger side, or a size in other units stays", async () => {
	const kept = [
		`<img src="https://x.example/a.png">`,
		`<img src="https://x.example/a.png" width="1">`,
		`<img src="https://x.example/spacer.gif" width="1" height="20">`,
		`<img src="https://x.example/a.png" width="42" height="auto" style="width:42px; height:auto">`,
		`<img src="https://x.example/a.png" style="width:1em;height:1em">`,
		`<img src="https://x.example/a.png" style="width:1%;height:1%">`,
	].join("");
	expect(await bodyOf(kept)).toBe(kept);
});
