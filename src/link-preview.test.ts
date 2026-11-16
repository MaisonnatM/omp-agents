import { describe, expect, test } from "bun:test";
import { parsePreview, readLinkPreview } from "./link-preview";

describe("parsePreview", () => {
	test("prefers Open Graph tags over the title and description tags", () => {
		const html = `<head><title>Plain</title><meta name="description" content="plain text"><meta property="og:title" content="Rich"><meta property="og:description" content="rich text"><meta property="og:site_name" content="Site"></head>`;
		expect(parsePreview(html)).toEqual({ title: "Rich", description: "rich text", site: "Site" });
	});

	test("falls back to the title tag and the first of each meta tag", () => {
		const html = `<title>
  Docs &amp; guides &#8212; &#x41;PI </title><meta content='first' name=description><meta name="description" content="second">`;
		expect(parsePreview(html)).toEqual({ title: "Docs & guides — API", description: "first", site: null });
	});

	test("decodes an attribute's references once", () => {
		expect(parsePreview(`<meta property="og:title" content="Tom &amp;amp; Jerry&nbsp;&lt;3">`)?.title).toBe("Tom &amp; Jerry <3");
	});

	test("does not take a data- attribute for the one it ends with", () => {
		const html = `<meta data-property="og:title" content="Wrong"><meta data-name="description" property="og:description" content="Right"><title>Title</title>`;
		expect(parsePreview(html)).toEqual({ title: "Title", description: "Right", site: null });
	});

	test("keeps an unknown or out-of-range reference as written", () => {
		expect(parsePreview("<title>&bogus; &#0; &#x110000;</title>")?.title).toBe("&bogus; &#0; &#x110000;");
	});

	test("caps text at 300 characters", () => {
		expect(parsePreview(`<title>${"a".repeat(400)}</title>`)?.title).toHaveLength(300);
	});

	test("answers null for a page with no title", () => {
		expect(parsePreview(`<meta property="og:description" content="only"><title>  </title>`)).toBeNull();
	});
});

describe("readLinkPreview", () => {
	test("answers null without fetching for anything but an HTTPS address, kept by the browser for an hour", async () => {
		for (const url of [null, "not a url", "http://example.com/", "file:///etc/passwd", "javascript:alert(1)"]) {
			const response = await readLinkPreview(url);
			expect(await response.json()).toBeNull();
			expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
		}
	});
});
