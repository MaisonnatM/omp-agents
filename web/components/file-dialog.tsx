import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
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
import { ViewerDialog } from "./viewer-dialog";

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
	return (
		<ViewerDialog
			title={name}
			description={file ? `${file.path} · ${formatBytes(file.size)}${file.truncated ? ` · first ${formatBytes(MAX_TEXT_FILE_BYTES)} shown` : ""}` : path}
			bodyLabel={name}
			onClose={onClose}
			actions={
				<>
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
				</>
			}
		>
			{file ? (
				<FileBody file={file} look={source ? "text" : look} />
			) : (
				<div className="p-4">
					<LoadNote loading="Reading the file…" error={read.error} />
				</div>
			)}
		</ViewerDialog>
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
