/** The Overview tab's Files section: a row per changed file, and the dialog of one file's recorded changes that a subagent's row opens. */
import { IconCode, IconConsole, IconFileBend, IconFileEdit, IconFileLock, IconFileText, IconImages1, IconJson, IconPageAdd, IconPageCross, IconTable } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type ReactNode, useMemo } from "react";
import { type ChangedFile, editHunks, type FileChange, type FileChangeKind, type FileStatus, fileStatus, lineTotals } from "../../src/shared/transcript";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { shortPaths } from "../changes-model";
import { age, readTime } from "../labels";
import { FileDiff } from "./file-diff";
import { LineCounts } from "./line-counts";
import { ViewerDialog } from "./viewer-dialog";

const CHANGE_LABEL: Record<FileChangeKind, string> = { created: "Created", edited: "Edited", rewritten: "Rewritten", deleted: "Deleted" };

const ICON_GROUPS: [IconComponent, string[]][] = [
	[IconCode, ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "swift", "kt", "java", "rb", "c", "h", "cc", "cpp", "hpp", "cs", "php", "css", "scss", "html", "vue", "svelte", "sql"]],
	[IconJson, ["json", "jsonc", "json5", "jsonl"]],
	[IconFileText, ["md", "mdx", "txt", "rst"]],
	[IconImages1, ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"]],
	[IconConsole, ["sh", "bash", "zsh", "fish"]],
	[IconFileEdit, ["yml", "yaml", "toml", "ini", "env", "conf", "cfg"]],
	[IconTable, ["csv", "tsv", "xlsx"]],
	[IconFileLock, ["lock", "lockb"]],
];

/** A file's icon by its extension, which a `Map` holds so that a name such as `constructor` finds none. */
const ICON_BY_EXTENSION = new Map(ICON_GROUPS.flatMap(([icon, extensions]) => extensions.map(extension => [extension, icon] as const)));

function iconOf(name: string): IconComponent {
	const dot = name.lastIndexOf(".");
	return (dot >= 0 && ICON_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase())) || IconFileBend;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A change's kind and time, then what it recorded: an edit's line counts and diff, or how many lines a write wrote. */
function Change({ path, change }: { path: string; change: FileChange }) {
	const diff = change.tool === "edit" ? change.diff : null;
	const hunks = useMemo(() => (diff ? editHunks(diff) : null), [diff]);
	const caption = (counts: ReactNode) => (
		<>
			<span className="font-medium text-foreground">{CHANGE_LABEL[change.kind]}</span>
			{change.at !== null && (
				<time className="text-muted-foreground" dateTime={new Date(change.at).toISOString()}>
					{readTime(change.at)}
				</time>
			)}
			<span className="flex-1" />
			{counts}
		</>
	);
	switch (change.tool) {
		case "edit": {
			const head = caption(<LineCounts added={change.added} removed={change.removed} />);
			return (
				<li className="space-y-1">
					{hunks ? <FileDiff path={path} hunks={hunks} caption={head} /> : <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">{head}</p>}
				</li>
			);
		}
		case "write":
			return (
				<li className="space-y-1">
					<p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
						{caption(change.lines !== null && <span className="shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums">{plural(change.lines, "line")}</span>)}
					</p>
					<p className="text-xs text-muted-foreground">Written whole, so omp recorded no diff.</p>
				</li>
			);
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

interface FileLook {
	icon: IconComponent;
	label: string;
	/** The tint of the file's mark, as affectUI's change summary tints its trend marks: green for new, red for deleted, gray for edited. */
	mark: string;
}

const FILE_LOOK: Record<FileStatus, FileLook> = {
	created: { icon: IconPageAdd, label: "New file", mark: "bg-diff-addition/10 text-diff-addition-foreground" },
	edited: { icon: IconFileEdit, label: "Edited", mark: "bg-muted text-muted-foreground" },
	deleted: { icon: IconPageCross, label: "Deleted", mark: "bg-diff-deletion/10 text-diff-deletion-foreground" },
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
			<ol className="space-y-3 p-4">
				{changes.toReversed().map((change, index) => (
					<Change key={changes.length - index} path={file.path} change={change} />
				))}
			</ol>
		</ViewerDialog>
	);
}

/**
 * The changed files in first-touch order, in the look of affectUI's change summary: each a row under a hairline, its
 * type's icon in a mark tinted by what happened to it, its name with the folders that tell it from another file of the
 * same name, and its line counts; the tooltip holds the whole path and what happened to it.
 */
export function ChangedFileList({ files, onOpen }: { files: ChangedFile[]; onOpen: (path: string) => void }) {
	const labels = shortPaths(files.map(file => file.path));
	return (
		<ul aria-label="Files changed" className="px-1 py-1">
			{files.map((file, index) => {
				const { name, dir } = labels[index]!;
				const { status, look, summary } = factsOf(file);
				const Icon = iconOf(name);
				return (
					// The rows rise in one after another, from the thirteenth on together, as the change summary's do.
					<li key={file.path} className="border-t border-border/60 first:border-t-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-500 motion-safe:fill-mode-both" style={{ animationDelay: `${120 + Math.min(index, 12) * 70}ms` }}>
						<Tooltip content={`${file.path} · ${summary}`} side="left">
							<button
								{...activityControl("changes-card.file")}
								type="button"
								aria-haspopup="dialog"
								onClick={() => onOpen(file.path)}
								className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
							>
								<span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-[5px]", look.mark)}>
									<Icon className="size-3" />
								</span>
								<span className="min-w-0 flex-1 truncate">
									{dir && <span className="text-muted-foreground">{dir}</span>}
									<span className={status === "deleted" ? "text-muted-foreground line-through" : "font-medium text-foreground"}>{name}</span>
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
