import { describe, expect, test } from "bun:test";
import { previewOf, readLinkPreview } from "./link-preview";

describe("previewOf", () => {
	test("prefers Open Graph tags over the title and description tags", () => {
		const html = `<head><title>Plain</title><meta name="description" content="plain text"><meta property="og:title" content="Rich"><meta property="og:description" content="rich text"><meta property="og:site_name" content="Site"></head>`;
		expect(previewOf(html)).toEqual({ title: "Rich", description: "rich text", site: "Site" });
	});

	test("falls back to the title tag and the first of each meta tag", () => {
		const html = `<title>
  Docs &amp; guides &#8212; &#x41;PI </title><meta content='first' name=description><meta name="description" content="second">`;
		expect(previewOf(html)).toEqual({ title: "Docs & guides — API", description: "first", site: null });
	});

	test("keeps an unknown or out-of-range reference as written", () => {
		expect(previewOf("<title>&bogus; &#0; &#x110000;</title>")?.title).toBe("&bogus; &#0; &#x110000;");
	});

	test("caps text at 300 characters", () => {
		expect(previewOf(`<title>${"a".repeat(400)}</title>`)?.title).toHaveLength(300);
	});

	test("answers null for a page with no title", () => {
		expect(previewOf(`<meta property="og:description" content="only"><title>  </title>`)).toBeNull();
	});
});

describe("readLinkPreview", () => {
	test("answers null without fetching for anything but an HTTPS address", async () => {
		for (const url of [null, "not a url", "http://example.com/", "file:///etc/passwd", "javascript:alert(1)"]) {
			expect(await (await readLinkPreview(url)).json()).toBeNull();
		}
	});
});
