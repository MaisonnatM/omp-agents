import { ChevronRight } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { ChangedEntry, ChangedFileText } from "../../../src/shared/changes";
import { fileTree, treeOrder } from "../../changes-model";
import { useRead } from "../../reads";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { LineCounts } from "../line-counts";
import { CodeView } from "./code-view";
import { FileTree, StatusLetter, statusLabel } from "./file-tree";

/** Diff shows the changes with unchanged runs folded; File shows the whole file as it is now, its changes marked in the gutter. */
const MODES = ["diff", "file"] as const;
type Mode = (typeof MODES)[number];
const MODE_KEY = "omp-agents.changes-mode";

interface ChangesExplorerProps {
	/** The changed files, at least one. */
	files: ChangedEntry[];
	/** The file open, by the path the list gives it; `null` opens the first. */
	path: string | null;
	/** The address that opens the file at `path`. */
	hrefFor: (path: string) => string;
	/** Opens the file at `path` in place, for the files, J, and K, instead of through its address. */
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
					<FileTree tree={tree} open={entry?.path ?? null} hrefFor={hrefFor} onPick={onPick} />
				</div>
			</nav>
			{entry && (
				<section aria-label={entry.path} className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
						<StatusLetter file={entry} />
						<p className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs text-muted-foreground" title={`${entry.path}: ${statusLabel(entry)}`}>
							{entry.path.split("/").map((part, index, parts) => (
								<Fragment key={index}>
									{index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" />}
									<span className={index === parts.length - 1 ? "truncate text-foreground" : "shrink-0"}>{part}</span>
								</Fragment>
							))}
						</p>
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
