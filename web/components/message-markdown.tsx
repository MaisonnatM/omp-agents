import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes. `github`: text written on
 * GitHub, whose raw HTML renders as GitHub renders it, through rehype-sanitize's schema, which follows GitHub's; HTML
 * comments drop out, as GitHub hides them.
 */
export function MessageMarkdown({ text, github = false }: { text: string; github?: boolean }) {
	return (
		<div className="message-markdown whitespace-normal break-words">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={github ? [rehypeRaw, rehypeSanitize, rehypeHighlight] : [rehypeHighlight]}
				components={{
					a: ({ children, node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
