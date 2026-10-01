import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** Markdown text is untrusted. react-markdown escapes raw HTML and filters unsafe link schemes. */
export function MessageMarkdown({ text }: { text: string }) {
	return (
		<div className="message-markdown whitespace-normal break-words">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={{
					a: ({ children, node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
