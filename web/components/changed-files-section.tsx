/** The changes card's Files section: a row per changed file, and the dialog of one file's recorded changes that a subagent's row opens. */
import {
	File as FileIcon,
	FileCode,
	FileCog,
	FileImage,
	FileJson,
	FileLock,
	FileMinus,
	FilePen,
	FilePlus,
	FileSpreadsheet,
	FileTerminal,
	FileText,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type ChangedFile, type FileChange, type FileChangeKind, type FileStatus, fileStatus, lineTotals, parseDiffLine } from "../../src/shared/transcript";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { shortPaths } from "../changes-model";
import { age, readTime } from "../labels";
import { LineCounts } from "./line-counts";
import { ViewerDialog } from "./viewer-dialog";

const CHANGE_LABEL: Record<FileChangeKind, string> = { created: "Created", edited: "Edited", rewritten: "Rewritten", deleted: "Deleted" };

const ICON_GROUPS: [LucideIcon, string[]][] = [
	[FileCode, ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "swift", "kt", "java", "rb", "c", "h", "cc", "cpp", "hpp", "cs", "php", "css", "scss", "html", "vue", "svelte", "sql"]],
	[FileJson, ["json", "jsonc", "json5", "jsonl"]],
	[FileText, ["md", "mdx", "txt", "rst"]],
	[FileImage, ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"]],
	[FileTerminal, ["sh", "bash", "zsh", "fish"]],
	[FileCog, ["yml", "yaml", "toml", "ini", "env", "conf", "cfg"]],
	[FileSpreadsheet, ["csv", "tsv", "xlsx"]],
	[FileLock, ["lock", "lockb"]],
];

/** A file's icon by its extension, which a `Map` holds so that a name such as `constructor` finds none. */
const ICON_BY_EXTENSION = new Map(ICON_GROUPS.flatMap(([icon, extensions]) => extensions.map(extension => [extension, icon] as const)));

function iconOf(name: string): LucideIcon {
	const dot = name.lastIndexOf(".");
	return (dot >= 0 && ICON_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase())) || FileIcon;
}

/** omp's numbered diff, `+12|added`, `-12|removed`, ` 12|context`, with blank lines between hunks. */
function Diff({ diff }: { diff: string }) {
	return (
		<div className="font-mono text-[11px] leading-4" data-diff>
			{diff.split("\n").map((line, index) => {
				const parsed = parseDiffLine(line);
				if (!parsed) return <div key={index} className="h-2" aria-hidden />;
				const { sign, number, text } = parsed;
				return (
					<div
						key={index}
						className={cn(
							"flex",
							sign === "+" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : sign === "-" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground",
						)}
					>
						<span className="w-10 shrink-0 pr-1.5 text-right opacity-60 select-none">{number}</span>
						<span className="w-3 shrink-0 select-none">{sign}</span>
						<span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{text || " "}</span>
					</div>
				);
			})}
		</div>
	);
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A change's kind and time, then what it recorded: an edit's line counts and diff, or how many lines a write wrote. */
function Change({ change }: { change: FileChange }) {
	let counts: ReactNode;
	let body: ReactNode;
	switch (change.tool) {
		case "edit":
			counts = <LineCounts added={change.added} removed={change.removed} />;
			body = change.diff && <Diff diff={change.diff} />;
			break;
		case "write":
			counts = change.lines !== null && <span className="shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums">{plural(change.lines, "line")}</span>;
			body = <p className="text-xs text-muted-foreground">Written whole, so omp recorded no diff.</p>;
			break;
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
	return (
		<li className="space-y-1">
			<p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{CHANGE_LABEL[change.kind]}</span>
				{change.at !== null && <time dateTime={new Date(change.at).toISOString()}>{readTime(change.at)}</time>}
				<span className="flex-1" />
				{counts}
			</p>
			{body}
		</li>
	);
}

interface FileLook {
	icon: LucideIcon;
	label: string;
}

const FILE_LOOK: Record<FileStatus, FileLook> = {
	created: { icon: FilePlus, label: "New file" },
	edited: { icon: FilePen, label: "Edited" },
	deleted: { icon: FileMinus, label: "Deleted" },
};

/** A changed file's look and what happened to it: its kind, how often, and when last. */
function factsOf(file: ChangedFile): { status: FileStatus; look: FileLook; summary: string } {
	const { changes } = file;
	const status = fileStatus(changes);
	const look = FILE_LOOK[status];
	const last = changes[changes.length - 1].at;
	const summary = [look.label, plural(changes.length, "change"), last !== null && `${age(last)} ago`].filter(Boolean).join(" · ");
	return { status, look, summary };
}

/** One file's changes over the page, newest first, each with what omp recorded; it follows the file while the agent edits it. */
export function FileChangesDialog({ file, onClose }: { file: ChangedFile; onClose: () => void }) {
	const { look, summary } = factsOf(file);
	const { changes } = file;
	return (
		<ViewerDialog
			icon={look.icon}
			title={file.path.slice(file.path.lastIndexOf("/") + 1)}
			description={`${file.path} · ${summary}`}
			actions={<LineCounts {...lineTotals(changes)} />}
			bodyLabel={`Changes to ${file.path}, newest first`}
			onClose={onClose}
		>
			<ol className="space-y-5 p-4">
				{changes.toReversed().map((change, index) => (
					<Change key={changes.length - index} change={change} />
				))}
			</ol>
		</ViewerDialog>
	);
}

/**
 * The changed files in first-touch order, each by its type's icon and its name, with the folders that tell it from
 * another file of the same name; the tooltip holds the whole path and what happened to it.
 */
export function ChangedFileList({ files, onOpen }: { files: ChangedFile[]; onOpen: (path: string) => void }) {
	const labels = shortPaths(files.map(file => file.path));
	return (
		<ul aria-label="Files changed" className="px-1 py-1">
			{files.map((file, index) => {
				const { name, dir } = labels[index]!;
				const { status, summary } = factsOf(file);
				const Icon = iconOf(name);
				return (
					<li key={file.path}>
						<Tooltip content={`${file.path} · ${summary}`} side="left">
							<button
								type="button"
								aria-haspopup="dialog"
								onClick={() => onOpen(file.path)}
								className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 truncate">
									{dir && <span className="text-muted-foreground">{dir}</span>}
									<span className={status === "deleted" ? "text-muted-foreground line-through" : "text-foreground"}>{name}</span>
								</span>
								<LineCounts {...lineTotals(file.changes)} />
							</button>
						</Tooltip>
					</li>
				);
			})}
		</ul>
	);
}
