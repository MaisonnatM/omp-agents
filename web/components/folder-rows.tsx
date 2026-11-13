/** `FolderRows`: a folder tree's rows, each folder a button that opens and closes it, which the changes explorer and the settings file rails share; `useFolders` keeps which folders are open. */
import { IconChevronBottom, IconChevronRight, IconFolder1 } from "central-icons";
import { Fragment, type ReactNode, useState } from "react";
import { foldersAbove, type TreeDir } from "../changes-model";

/** Which folders of a tree are closed, and the toggle that opens or closes one. */
export interface Folders {
	isShut: (path: string) => boolean;
	toggle: (path: string) => void;
}

/**
 * The open folders of `tree`: all of them when `startOpen`, else only those above `open`. When `open` changes, the
 * folders above it open again.
 */
export function useFolders<T extends { path: string }>(tree: TreeDir<T>, open: string | null, startOpen: boolean): Folders {
	const above = (path: string | null): string[] => (path === null ? [] : (foldersAbove(tree, path) ?? []));
	// The folders whose state differs from `startOpen`.
	const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set(startOpen ? [] : above(open)));
	const [revealed, setRevealed] = useState(open);
	if (revealed !== open) {
		setRevealed(open);
		const next = new Set(flipped);
		for (const path of above(open)) {
			if (startOpen) next.delete(path);
			else next.add(path);
		}
		if (next.size !== flipped.size) setFlipped(next);
	}
	return {
		isShut: path => flipped.has(path) === startOpen,
		toggle: path =>
			setFlipped(prev => {
				const next = new Set(prev);
				if (!next.delete(path)) next.add(path);
				return next;
			}),
	};
}

/** How far a folder's row at `depth` sits from the tree's edge, in pixels. */
const indentOf = (depth: number): number => depth * 12 + 4;

/** `dir`'s folders, then its files, as `<li>` rows at `depth`; a folder's rows follow it unless `folders` says it is closed. The rows take the list's font size. */
export function FolderRows<T extends { path: string }>({
	dir,
	depth,
	folders,
	file,
}: {
	dir: TreeDir<T>;
	depth: number;
	folders: Folders;
	/** A file's row, given its left padding in pixels, which clears the folders' chevrons. */
	file: (file: T, indent: number) => ReactNode;
}) {
	return (
		<>
			{dir.dirs.map(child => {
				const shut = folders.isShut(child.path);
				const Chevron = shut ? IconChevronRight : IconChevronBottom;
				return (
					<Fragment key={child.path}>
						<li>
							<button
								type="button"
								aria-expanded={!shut}
								className="flex w-full items-center gap-1 rounded-md py-0.5 pr-1 text-left text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
								style={{ paddingLeft: indentOf(depth) }}
								onClick={() => folders.toggle(child.path)}
							>
								<Chevron aria-hidden className="size-3 shrink-0" />
								<IconFolder1 className="size-3.5 shrink-0" />
								<span className="truncate">{child.name}</span>
							</button>
						</li>
						{!shut && <FolderRows dir={child} depth={depth + 1} folders={folders} file={file} />}
					</Fragment>
				);
			})}
			{dir.files.map(entry => (
				<li key={entry.path}>{file(entry, indentOf(depth) + 16)}</li>
			))}
		</>
	);
}
