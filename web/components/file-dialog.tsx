import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MAX_TEXT_FILE_BYTES, type TextFile } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { parseDelimited } from "../delimited";
import { formatBytes } from "../labels";
import { useRead } from "../reads";
import { useCopy } from "../use-copy";
import { FileBaseContext } from "./file-link";
import { MessageMarkdown } from "./message-markdown";
import { LoadNote } from "./sheet-details";

/** The rows a table shows; a longer file shows the rest as its source. */
const MAX_TABLE_ROWS = 1000;

type Look = "markdown" | "tsv" | "csv" | "text";

const LOOKS: Record<string, Look> = { md: "markdown", markdown: "markdown", tsv: "tsv", csv: "csv" };

/** A text file that a path in agent text opened, rendered by its type; a path in the file opens in its place. */
export function FileDialog({ path, onClose }: { path: string; onClose: () => void }) {
	const read = useRead<TextFile>(`/api/file?${new URLSearchParams({ path })}`);
	const look = LOOKS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "text";
	const [source, setSource] = useState(false);
	const { copied, copy } = useCopy();
	const file = read.data;
	const name = path.slice(path.lastIndexOf("/") + 1);
	const body = useRef<HTMLDivElement>(null);
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					// The file takes focus, so the arrow keys scroll it and no header tooltip opens.
					onOpenAutoFocus={event => {
						event.preventDefault();
						body.current?.focus();
					}}
					className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100vh-4rem)] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden"
				>
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-0.5">
							<DialogPrimitive.Title className="truncate text-sm font-semibold">{name}</DialogPrimitive.Title>
							<DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
								{file ? `${file.path} · ${formatBytes(file.size)}${file.truncated ? ` · first ${formatBytes(MAX_TEXT_FILE_BYTES)} shown` : ""}` : path}
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{look !== "text" && file && (
								<Button variant="ghost" size="compact" onClick={() => setSource(shown => !shown)}>
									{source ? "Show rendered" : "Show source"}
								</Button>
							)}
							<Tooltip content={copied ? "Copied" : "Copy the path"}>
								<Button variant="ghost" size="icon-compact" aria-label="Copy the path" onClick={() => copy(file?.path ?? path)}>
									{copied ? <Check /> : <Copy />}
								</Button>
							</Tooltip>
							<Tooltip content="Close" shortcut={["Esc"]}>
								<DialogPrimitive.Close asChild>
									<Button variant="ghost" size="icon-compact" aria-label="Close">
										<X />
									</Button>
								</DialogPrimitive.Close>
							</Tooltip>
						</div>
					</div>
					<div ref={body} role="region" tabIndex={0} aria-label={name} className="min-h-0 flex-1 overflow-auto rounded-md border border-border outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
						{file ? (
							<FileBody file={file} look={source ? "text" : look} />
						) : (
							<div className="p-4">
								<LoadNote loading="Reading the file…" error={read.error} />
							</div>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function FileBody({ file, look }: { file: TextFile; look: Look }) {
	if (look === "markdown") {
		return (
			<FileBaseContext.Provider value={file.path.slice(0, file.path.lastIndexOf("/"))}>
				<article className="px-5 py-3 text-sm leading-relaxed">
					<MessageMarkdown text={file.text} />
				</article>
			</FileBaseContext.Provider>
		);
	}
	if (look === "tsv" || look === "csv") return <Table text={file.text} separator={look === "tsv" ? "\t" : ","} />;
	return <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre">{file.text}</pre>;
}

function Table({ text, separator }: { text: string; separator: "\t" | "," }) {
	const [head = [], ...body] = useMemo(() => parseDelimited(text, separator), [text, separator]);
	const cell = "border-b border-r border-border px-2 py-1 text-left align-top whitespace-pre-wrap";
	return (
		<>
			<table className="w-max min-w-full border-separate border-spacing-0 text-xs">
				<thead className="sticky top-0 bg-muted">
					<tr>
						{head.map((value, index) => (
							<th key={index} className={`${cell} font-semibold`}>
								{value}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{body.slice(0, MAX_TABLE_ROWS).map((row, index) => (
						<tr key={index}>
							{row.map((value, column) => (
								<td key={column} className={cell}>
									{value}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{body.length > MAX_TABLE_ROWS && (
				<p className="p-3 text-xs text-muted-foreground">
					Showing the first {MAX_TABLE_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows. Show the source for the rest.
				</p>
			)}
		</>
	);
}
