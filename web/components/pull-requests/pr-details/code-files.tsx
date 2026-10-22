import { useMemo } from "react";
import type { ChangedEntry } from "../../../../src/shared/changes";
import { fileTree } from "../../../changes-model";
import { DiffStack } from "../../changes/diff-stack";
import { type FileOpen, FileStepHint, FileTree } from "../../changes/file-tree";
import { useFileCursor } from "../../changes/use-file-cursor";

type CodeFilesProps = FileOpen & {
	/** The changed files in the server's reading order, at least one. */
	files: readonly ChangedEntry[];
	/** The file asked for; `null` opens the first. */
	path: string | null;
	fileUrl: (path: string) => string;
	version: string;
	treeOpen: boolean;
	collapsed: ReadonlySet<string>;
	onCollapse: (path: string, value: boolean) => void;
};

/** The Code tab's diffs in the server's reading order, with the folder tree at their right as T3 lays it out. */
export function CodeFiles({ files, path, fileUrl, version, treeOpen, collapsed, onCollapse, ...opener }: CodeFilesProps) {
	const tree = useMemo(() => fileTree(files), [files]);
	const { stack, entry, open, setCurrent } = useFileCursor(files, path, opener);
	return (
		<div className="flex min-h-0 flex-1">
			<DiffStack
				ref={stack}
				files={files}
				fileUrl={fileUrl}
				version={version}
				initial={entry?.path ?? null}
				onCurrent={setCurrent}
				collapsed={collapsed}
				onCollapse={onCollapse}
			/>
			{treeOpen && (
				<nav aria-label="Changed files" className="flex w-[min(20rem,40%)] min-w-40 shrink-0 flex-col border-l border-border">
					<FileStepHint />
					<div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
						<FileTree tree={tree} open={entry?.path ?? null} hrefFor={opener.hrefFor} onPick={open} />
					</div>
				</nav>
			)}
		</div>
	);
}
