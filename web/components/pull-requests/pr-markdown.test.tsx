import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageMarkdown } from "../message-markdown";
import { PullRequestMarkdown } from "./pr-markdown";

const render = (text: string) => renderToStaticMarkup(<PullRequestMarkdown text={text} repo={{ owner: "acme", repo: "app" }} />);

test("PR autolinks work through rendered GFM without touching code or existing links", () => {
	const html = render("Fix #42 at 0123456789abcdef0123456789abcdef01234567.\n\n`#12` [#13](https://example.com) <a href=\"https://example.org\"><b>#14</b></a> <code>#16</code>\n\n```text\n#15\n```\n\n<pre>#17</pre>\n\n> [!WARNING]\n> See #18");
	expect(html).toContain('href="https://github.com/acme/app/issues/42"');
	expect(html).toContain('href="https://github.com/acme/app/commit/0123456789abcdef0123456789abcdef01234567"');
	expect(html).toContain(">0123456</span>");
	for (const number of [12, 13, 14, 15, 16, 17]) expect(html).not.toContain(`/issues/${number}`);
	expect(html).toContain('href="https://github.com/acme/app/issues/18"');
	expect(html).toContain("Warning");
	expect(html).not.toContain("[!WARNING]");
});

test("PR media rewrites Markdown and HTML images, plays GitHub videos and cards other attachments", () => {
	const html = render('![Shot](https://private-user-images.githubusercontent.com/1/a.png)\n\n<img width="200" alt="Upload" src="https://github.com/user-attachments/assets/image">\n\nhttps://github.com/user-attachments/assets/video\n\nhttps://github.com/user-attachments/files/42/report.pdf');
	expect(html).toContain('src="/api/github-media?url=https%3A%2F%2Fprivate-user-images.githubusercontent.com%2F1%2Fa.png"');
	expect(html).toContain('src="/api/github-media?url=https%3A%2F%2Fgithub.com%2Fuser-attachments%2Fassets%2Fimage"');
	expect(html).toContain('width="200"');
	expect(html).toContain('<video controls="" preload="metadata" src="/api/github-media?url=https%3A%2F%2Fgithub.com%2Fuser-attachments%2Fassets%2Fvideo"');
	expect(html).toContain('href="https://github.com/user-attachments/files/42/report.pdf"');
	expect(html).toContain("Open attachment on GitHub");
	const source = render('See [the log][log].\n\n<video controls>\n<source src="https://user-images.githubusercontent.com/1/demo.mp4">\n</video>\n\n```\nhttps://github.com/user-attachments/assets/fenced\n```\n\n[log]: https://example.com/log');
	expect(source).toContain('<a href="https://example.com/log"');
	expect(source).toContain('<video controls="" preload="metadata" src="/api/github-media?url=https%3A%2F%2Fuser-images.githubusercontent.com%2F1%2Fdemo.mp4"');
	expect(source).not.toContain("assets%2Ffenced");
	expect(render("![External](https://example.com/a.png)")).toContain('<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">External</a>');
});

test("PR customization leaves transcript alerts, autolinks and remote-image restrictions unchanged", () => {
	const html = renderToStaticMarkup(<MessageMarkdown text={"> [!NOTE]\n> #42\n\n![Private](https://private-user-images.githubusercontent.com/1/a.png)"} />);
	expect(html).toContain("<blockquote>");
	expect(html).toContain("[!NOTE]");
	expect(html).not.toContain("/issues/42");
	expect(html).not.toContain("/api/github-media");
	expect(html).not.toContain('<img src="https://private-user-images');
	expect(render('<script>alert(1)</script>\n\n<img src="javascript:alert(1)" onerror="bad()">')).not.toContain("<script>");
	expect(render('<img src="https://github.com/user-attachments/assets/a" onerror="bad()">')).not.toContain("onerror");
});
