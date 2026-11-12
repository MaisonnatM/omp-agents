/** A text file shown for reading: Markdown rendered under its frontmatter's properties, anything else as colored, numbered lines. */
import { useMemo } from "react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";
import type { Frontmatter } from "../../src/shared/models";
import type { FileBase } from "../file-paths";
import { FileBaseContext } from "./file-link";
import { CodeLines, MessageMarkdown } from "./message-markdown";

/** The extension of `path`'s name, lowercased; `""` when it has none. */
export const extensionOf = (path: string): string => {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
};

/** Whether `path` names a Markdown file, which reads rendered. */
export const isMarkdownPath = (path: string): boolean => ["md", "markdown"].includes(extensionOf(path));

/** The Markdown file at `path` with its frontmatter, as the server read it, as a list of properties above the rest; a relative path in it opens against the file's directory. */
export function MarkdownDocument({ text, frontmatter, path, className }: { text: string; frontmatter?: Frontmatter; path: string; className?: string }) {
	const dir = path.slice(0, path.lastIndexOf("/"));
	const base = useMemo((): FileBase => ({ dir, session: null }), [dir]);
	const fields = frontmatter?.fields ?? [];
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
				<MessageMarkdown text={frontmatter ? text.slice(frontmatter.end) : text} />
			</article>
		</FileBaseContext.Provider>
	);
}

/**
 * `text` as numbered lines that wrap, colored by `path`'s extension; a token longer than a line, such as minified CSS, breaks anywhere.
 * The newline that ends the last line numbers no empty line after it.
 */
export function CodeText({ text, path, className }: { text: string; path: string; className?: string }) {
	return (
		<CodeBlock size="sm" className={cn("code-lines", className)}>
			<CodeBlockContent wrap lineNumbers aria-label={`Contents of ${path}`} className="data-wrap:wrap-anywhere">
				<CodeLines text={text.endsWith("\n") ? text.slice(0, -1) : text} language={extensionOf(path)} />
			</CodeBlockContent>
		</CodeBlock>
	);
}
