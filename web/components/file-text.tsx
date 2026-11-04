/** A text file shown for reading: Markdown rendered under its frontmatter's properties, anything else as colored, numbered lines. */
import { useMemo } from "react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";
import type { FileBase } from "../file-paths";
import { splitFrontmatter } from "../frontmatter";
import { FileBaseContext } from "./file-link";
import { CodeLines, MessageMarkdown } from "./message-markdown";

/** The extension of `path`'s name, lowercased; `""` when it has none. */
const extensionOf = (path: string): string => {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
};

/** Whether `path` names a Markdown file, which reads rendered. */
export const isMarkdownPath = (path: string): boolean => ["md", "markdown"].includes(extensionOf(path));

/** Markdown text with its frontmatter as a list of properties above it; a relative path in it opens against `dir`. */
export function MarkdownDocument({ text, dir, className }: { text: string; dir: string; className?: string }) {
	const { fields, body } = useMemo(() => splitFrontmatter(text), [text]);
	const base = useMemo((): FileBase => ({ dir, session: null }), [dir]);
	return (
		<FileBaseContext.Provider value={base}>
			<article className={cn("text-sm leading-relaxed", className)}>
				{fields.length > 0 && (
					<dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 border-b border-border pb-4 text-xs">
						{fields.map(({ key, value }) => (
							<div key={key} className="contents">
								<dt className="text-muted-foreground">{key}</dt>
								<dd className={cn("min-w-0 break-words", value.includes("\n") && "whitespace-pre-wrap font-mono")}>{value}</dd>
							</div>
						))}
					</dl>
				)}
				<MessageMarkdown text={body} />
			</article>
		</FileBaseContext.Provider>
	);
}

/** `text` as numbered lines that wrap, colored by `path`'s extension. */
export function CodeText({ text, path, className }: { text: string; path: string; className?: string }) {
	return (
		<CodeBlock size="sm" className={cn("code-lines", className)}>
			<CodeBlockContent wrap lineNumbers aria-label={`Contents of ${path}`}>
				<CodeLines text={text} language={extensionOf(path)} />
			</CodeBlockContent>
		</CodeBlock>
	);
}
