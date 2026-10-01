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
