import { Check, Copy } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { MAX_TEXT_FILE_BYTES, type TextFile } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { mediaSrc } from "../api";
import { type FileTarget, linkedFile, mediaFileUrl, textFileUrl } from "../file-paths";
import { parseDelimited } from "../delimited";
import { formatBytes } from "../labels";
import { useRead } from "../reads";
import { useCopy } from "../use-copy";
import { CodeText, extensionOf, isMarkdownPath, MarkdownDocument } from "./file-text";
import { LoadNote } from "./sheet-details";
import { ViewerDialog } from "./viewer-dialog";
import { useZoom, type Zoom } from "./zoom-pane";

/** The rows a table shows; a longer file shows the rest as its source. */
const MAX_TABLE_ROWS = 1000;

type Look = "markdown" | "tsv" | "csv" | "text";

const TABLES: Record<string, Look> = { tsv: "tsv", csv: "csv" };

/** A file that a path in agent text opened: an image or video large, else a text file rendered by its type. */
export function FileDialog({ target, onClose }: { target: FileTarget; onClose: () => void }) {
	const kind = linkedFile(target.path)?.kind;
	if (kind === "image") return <ImageFileDialog target={target} onClose={onClose} />;
	if (kind === "video") return <VideoFileDialog target={target} onClose={onClose} />;
	return <TextFileDialog target={target} onClose={onClose} />;
}

const LOAD_FAILED = <p className="text-sm text-muted-foreground">This file could not be loaded: it is missing, or lies in a directory that does not open here.</p>;

/** An image on this computer, fitted to the dialog, that zooms; one that loads nothing says so. */
function ImageFileDialog({ target, onClose }: { target: FileTarget; onClose: () => void }) {
	const [failed, setFailed] = useState(false);
	const zoom = useZoom(target.path);
	const name = target.path.slice(target.path.lastIndexOf("/") + 1);
	return (
		<MediaFileDialog target={target} zoom={failed ? undefined : zoom} onClose={onClose}>
			{failed ? (
				<div className="flex min-h-full items-center justify-center p-4">{LOAD_FAILED}</div>
			) : (
				<img src={mediaSrc(mediaFileUrl(target))} alt={name} draggable={false} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain p-4" />
			)}
		</MediaFileDialog>
	);
}

/** A video on this computer, which plays at once; one that loads nothing says so. */
function VideoFileDialog({ target, onClose }: { target: FileTarget; onClose: () => void }) {
	const [failed, setFailed] = useState(false);
	return (
		<MediaFileDialog target={target} onClose={onClose}>
			<div className="flex min-h-full items-center justify-center p-4">
				{failed ? LOAD_FAILED : <video controls autoPlay src={mediaSrc(mediaFileUrl(target))} onError={() => setFailed(true)} className="max-h-[75vh] max-w-full bg-black" />}
			</div>
		</MediaFileDialog>
	);
}

/** The dialog an image or video file shows in: its name, its path, and a button that copies the path. */
function MediaFileDialog({ target, zoom, onClose, children }: { target: FileTarget; zoom?: Zoom; onClose: () => void; children: ReactNode }) {
	const { copied, copy } = useCopy();
	const { path } = target;
	const name = path.slice(path.lastIndexOf("/") + 1);
	return (
		<ViewerDialog
			title={name}
			description={path}
			bodyLabel={name}
			zoom={zoom}
			onClose={onClose}
			actions={
				<Tooltip content={copied ? "Copied" : "Copy the path"}>
					<Button {...activityControl("file-dialog.copy-path")} variant="ghost" size="icon-compact" aria-label="Copy the path" onClick={() => copy(path)}>
						{copied ? <Check /> : <Copy />}
					</Button>
				</Tooltip>
			}
		>
			{children}
		</ViewerDialog>
	);
}

/** A text file rendered by its type; a path in the file opens in its place. */
function TextFileDialog({ target, onClose }: { target: FileTarget; onClose: () => void }) {
	const { path } = target;
	const read = useRead<TextFile>(textFileUrl(target));
	const look = isMarkdownPath(path) ? "markdown" : (TABLES[extensionOf(path)] ?? "text");
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
						<Button {...activityControl("file-dialog.source")} variant="ghost" size="compact" onClick={() => setSource(shown => !shown)}>
							{source ? "Show rendered" : "Show source"}
						</Button>
					)}
					<Tooltip content={copied ? "Copied" : "Copy the path"}>
						<Button {...activityControl("file-dialog.copy-path")} variant="ghost" size="icon-compact" aria-label="Copy the path" onClick={() => copy(file?.path ?? path)}>
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
	if (look === "markdown") return <MarkdownDocument text={file.text} frontmatter={file.frontmatter} path={file.path} className="px-5 py-3" />;
	if (look === "tsv" || look === "csv") return <Table text={file.text} separator={look === "tsv" ? "\t" : ","} />;
	return <CodeText text={file.text} path={file.path} className="rounded-none border-0" />;
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
