import { useMemo } from "react";
import type { ChangedEntry, ChangedFileText } from "../../../src/shared/changes";
import { fileTree, treeOrder } from "../../changes-model";
import { useRead } from "../../reads";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { LineCounts } from "../line-counts";
import { CodeView } from "./code-view";
import { type FileDecoration, FileTree, PathCrumbs } from "./file-tree";

/** Diff shows the changes with unchanged runs folded; File shows the whole file as it is now, its changes marked in the gutter. */
const MODES = ["diff", "file"] as const;
type Mode = (typeof MODES)[number];
const MODE_KEY = "omp-agents.changes-mode";

const STATUS = {
	added: { letter: "A", tone: "text-emerald-600 dark:text-emerald-400", label: "Added" },
	untracked: { letter: "U", tone: "text-emerald-600 dark:text-emerald-400", label: "Untracked" },
	modified: { letter: "M", tone: "text-amber-600 dark:text-amber-400", label: "Modified" },
	deleted: { letter: "D", tone: "text-red-600 dark:text-red-400", label: "Deleted" },
	renamed: { letter: "R", tone: "text-violet-600 dark:text-violet-400", label: "Renamed" },
	// Outside the checkout, or changed back to the base: git lists no change.
	unlisted: { letter: "S", tone: "text-sky-600 dark:text-sky-400", label: "Changed by this session; git shows no change against the base" },
} as const;

/** What happened to `file`, and whether this session's own calls changed it. */
function statusLabel(file: ChangedEntry): string {
	const { label } = STATUS[file.status ?? "unlisted"];
	return file.session && file.status !== null ? `${label}; this session edited it` : label;
}

function StatusLetter({ file }: { file: ChangedEntry }) {
	const look = STATUS[file.status ?? "unlisted"];
	return (
		<span title={statusLabel(file)} className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", look.tone)}>
			{look.letter}
		</span>
	);
}

/** A changed file's row in the explorer: struck through once deleted, then a dot when a session's own calls changed it, its lines added and removed, and its status letter. */
function changeDecoration(file: ChangedEntry): FileDecoration {
	return {
		title: `${file.path}: ${statusLabel(file)}`,
		struck: file.status === "deleted",
		trailing: (
			<>
				{file.session && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sky-500" />}
				<LineCounts added={file.added} removed={file.removed} />
				<StatusLetter file={file} />
			</>
		),
	};
}

interface ChangesExplorerProps {
	/** The changed files, at least one. */
	files: ChangedEntry[];
	/** The file open, by the path the list gives it; `null` opens the first. */
	path: string | null;
	/** The address that opens the file at `path`. */
	hrefFor: (path: string) => string;
	/** Opens the file at `path` in place, for the files, ↓, and ↑, instead of through its address. */
	onPick?: (path: string) => void;
	/** The read of the file at `path` in full, with its diff. */
	fileUrl: (path: string) => string;
	/** A new version reads the open file again. */
	version: string | number;
}

/**
 * Changed files as an editor shows them, for a session's changes page and a pull request's: the explorer lists them as
 * folders, and the editor shows the open file's diff or the whole file with its changes marked.
 */
export function ChangesExplorer({ files, path, hrefFor, onPick, fileUrl, version }: ChangesExplorerProps) {
	const [mode, setMode] = useStoredState<Mode>(MODE_KEY, raw => MODES.find(mode => mode === raw) ?? "diff");
	const tree = useMemo(() => fileTree(files), [files]);
	const order = useMemo(() => treeOrder(tree), [tree]);
	const entry = order.find(file => file.path === path) ?? order[0] ?? null;
	const read = useRead<ChangedFileText>(entry && fileUrl(entry.path), version);
	const step = (by: 1 | -1): boolean => {
		if (!entry) return false;
		const next = order[order.indexOf(entry) + by];
		if (!next) return true;
		if (onPick) onPick(next.path);
		else location.hash = hrefFor(next.path);
		return true;
	};
	useShortcuts({ nextChangedFile: () => step(1), previousChangedFile: () => step(-1) });

	return (
		<div className="flex min-h-0 flex-1">
			<nav aria-label="Changed files" className="flex w-72 shrink-0 flex-col border-r border-border">
				<p className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
					<kbd>{shortcutLabels("nextChangedFile")[0]}</kbd> and <kbd>{shortcutLabels("previousChangedFile")[0]}</kbd> step through the files
				</p>
				<div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
					<FileTree tree={tree} open={entry?.path ?? null} hrefFor={hrefFor} onPick={onPick} decorate={changeDecoration} />
				</div>
			</nav>
			{entry && (
				<section aria-label={entry.path} className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
						<StatusLetter file={entry} />
						<PathCrumbs path={entry.path} title={`${entry.path}: ${statusLabel(entry)}`} />
						<LineCounts added={entry.added} removed={entry.removed} />
						<SizeProvider size="compact">
							<Tabs value={mode} onValueChange={value => setMode(value as Mode)}>
								<TabsList aria-label="Show">
									<TabItem value="diff" label="Diff" tooltip="The changes, with unchanged lines folded" />
									<TabItem value="file" label="File" tooltip="The whole file as it is now, its changes marked in the gutter" />
								</TabsList>
							</Tabs>
						</SizeProvider>
					</div>
					{/* Keyed by file, so unfolded runs and shown removals start closed in the next one. */}
					<CodeView key={entry.path} mode={mode} file={read.data} error={read.error} />
				</section>
			)}
		</div>
	);
}
