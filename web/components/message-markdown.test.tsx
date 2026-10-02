import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageMarkdown } from "./message-markdown";

test("messages render GFM and refuse executable markup", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown text={'# Report\n\n- [x] done\n\n| Key | Value |\n| --- | --- |\n| answer | 42 |\n\n```ts\nconst answer = 42\n```\n\n[link](https://example.com) <script>alert(1)</script>'} />,
	);
	expect(html).toContain("<h1>Report</h1>");
	expect(html).toContain('type="checkbox" disabled="" checked=""');
	expect(html).toContain("<table>");
	expect(html).toContain("hljs-keyword");
	expect(html).toContain('target="_blank" rel="noopener noreferrer"');
	expect(html).not.toContain("<script>");
	expect(html).not.toContain('node="[object Object]"');
});

test("unfinished streaming fences remain code blocks", () => {
	const html = renderToStaticMarkup(<MessageMarkdown text={"Before\n\n```ts\nconst answer = 42"} />);
	expect(html).toContain("<pre>");
	expect(html).toContain("hljs-keyword");
	expect(html).toContain("answer");
});

test("GitHub text renders the HTML GitHub allows, hides comments, and still refuses executable markup", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown
			github
			text={'<!-- CURSOR_SUMMARY -->\n<details><summary>More</summary>\n\nHidden **bold**\n\n</details>\n\n<img src="x" onerror="alert(1)"> <script>alert(1)</script>\n\n```ts\nconst answer = 42\n```'}
		/>,
	);
	expect(html).toContain("<details><summary>More</summary>");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).toContain("hljs-keyword");
	expect(html).not.toContain("CURSOR_SUMMARY");
	expect(html).not.toContain("onerror");
	expect(html).not.toContain("<script>");
});
