import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedEntry } from "../../../src/shared/changes";
import { fileTree, treeOrder } from "../../changes-model";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { LineCounts } from "../line-counts";
import { Separator, useDragSeparator } from "../drag-separator";
import { CodeView } from "./code-view";
import { DiffStack, type DiffStackHandle } from "./diff-stack";
import { type FileOpen, FileTree, StatusLetter, statusLabel } from "./file-tree";

/** Diff lists every file's changes in one scroll, unchanged runs folded; File shows the open file whole as it is now, its changes marked in the gutter. */
const MODES = ["diff", "file"] as const;
type Mode = (typeof MODES)[number];
const MODE_KEY = "omp-agents.changes-mode";
const LIST_KEY = "omp-agents.changes-list-width";
const DEFAULT_LIST = 288;
const MIN_LIST = 180;
const MAX_LIST = 560;

const clampList = (width: number): number => Math.round(Math.max(MIN_LIST, Math.min(MAX_LIST, width)));

type ChangesExplorerProps = FileOpen & {
	/** The changed files, at least one. */
	files: ChangedEntry[];
	/** The file asked for, by the path the list gives it; `null` opens the first. */
	path: string | null;
	/** The read of one file in full, with its diff. */
	fileUrl: (path: string) => string;
	/** A new version reads the files read so far again. */
	version: string | number;
};

/**
 * Changed files as an editor shows them, for a session's changes and a pull request's: the explorer lists them as
 * folders, and the editor shows every file's diff in one scroll, or the open file whole with its changes marked.
 */
export function ChangesExplorer({ files, path, fileUrl, version, ...opener }: ChangesExplorerProps) {
	const [mode, setMode] = useStoredState<Mode>(MODE_KEY, raw => MODES.find(mode => mode === raw) ?? "diff");
	const [listWidth, setListWidth] = useStoredState(LIST_KEY, raw => {
		const stored = Number(raw);
		return stored >= MIN_LIST && stored <= MAX_LIST ? stored : DEFAULT_LIST;
	});
	const resize = useDragSeparator({
		value: listWidth,
		onValue: setListWidth,
		axis: "vertical",
		keyStep: 16,
		shiftSteps: 4,
		min: MIN_LIST,
		max: MAX_LIST,
		reset: DEFAULT_LIST,
		clamp: clampList,
		read: (event, start) => clampList(start.value + event.clientX - start.coordinate),
	});
	const tree = useMemo(() => fileTree(files), [files]);
	const order = useMemo(() => treeOrder(tree), [tree]);
	// The file the explorer marks: the one asked for, then the one at the top of the diffs as you scroll them.
	const [current, setCurrent] = useState(path);
	const stack = useRef<DiffStackHandle>(null);
	useEffect(() => {
		setCurrent(path);
		if (path !== null) stack.current?.scrollTo(path);
	}, [path]);
	const entry = order.find(file => file.path === current) ?? order[0] ?? null;
	const open = (next: string): void => {
		setCurrent(next);
		stack.current?.scrollTo(next);
		if (opener.hrefFor && !opener.onPick) location.hash = opener.hrefFor(next);
		else opener.onPick?.(next);
	};
	const step = (by: 1 | -1): boolean => {
		if (!entry) return false;
		const next = order[order.indexOf(entry) + by];
		if (next) open(next.path);
		return true;
	};
	useShortcuts({ nextChangedFile: () => step(1), previousChangedFile: () => step(-1) });

	return (
		<div className="relative flex min-h-0 flex-1">
			<nav aria-label="Changed files" style={{ width: listWidth }} className="flex shrink-0 flex-col border-r border-border">
				<p className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
					<kbd>{shortcutLabels("nextChangedFile")[0]}</kbd> and <kbd>{shortcutLabels("previousChangedFile")[0]}</kbd> step through the files
				</p>
				<div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
					<FileTree tree={tree} open={entry?.path ?? null} hrefFor={opener.hrefFor} onPick={open} />
				</div>
			</nav>
			<Separator
				{...resize}
				axis="vertical"
				label="Resize the file list"
				min={MIN_LIST}
				max={MAX_LIST}
				now={listWidth}
				style={{ left: listWidth }}
				className="inset-y-0 w-3 -translate-x-1/2 cursor-col-resize select-none"
			/>
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
									<TabItem value="diff" label="Diff" tooltip="Every file's changes in one list, with unchanged lines folded" />
									<TabItem value="file" label="File" tooltip="The whole file as it is now, its changes marked in the gutter" />
								</TabsList>
							</Tabs>
						</SizeProvider>
					</div>
					{mode === "diff" ? (
						<DiffStack ref={stack} files={order} fileUrl={fileUrl} version={version} initial={entry.path} onCurrent={setCurrent} />
					) : (
						// Keyed by file, so shown removals start closed in the next one.
						<CodeView key={entry.path} url={fileUrl(entry.path)} version={version} />
					)}
				</section>
			)}
		</div>
	);
}
