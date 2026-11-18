/** `FolderRows`: a folder tree's rows in the look of affectUI's tree view, each folder a button that opens and closes it, which the changes explorer and the settings file rails share; `useFolders` keeps which folders are open. */
import { IconChevronRightSmall, IconFolder1, IconFolderOpen } from "central-icons";
import { type CSSProperties, type ReactNode, useState } from "react";
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

/** How far a folder's row at `depth` sits from the tree's edge, in pixels: 16 a level, as affectUI's tree view indents. */
const indentOf = (depth: number): number => depth * 16 + 6;

/** The chevron's box, which a file row's indent clears and an open folder's guide runs under. */
const CHEVRON = 16;

/**
 * `dir`'s folders, then its files, as `<li>` rows at `depth`; an open folder's rows follow it in a list of their own,
 * with a thin guide under its chevron that darkens while one of them is the current file. The rows take the list's font size.
 */
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
				const Folder = shut ? IconFolder1 : IconFolderOpen;
				return (
					<li key={child.path}>
						<button
							type="button"
							aria-expanded={!shut}
							className="group/folder flex h-7 w-full items-center gap-1 rounded-md pr-1.5 text-left text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
							style={{ paddingLeft: indentOf(depth) }}
							onClick={() => folders.toggle(child.path)}
						>
							<span aria-hidden className="grid size-4 shrink-0 place-items-center text-muted-foreground/60 transition-transform duration-200 ease-out group-hover/folder:text-muted-foreground group-aria-expanded/folder:rotate-90 motion-reduce:transition-none">
								<IconChevronRightSmall className="size-3" />
							</span>
							<Folder className="mr-1 size-4 shrink-0" />
							<span className="truncate">{child.name}</span>
						</button>
						{!shut && (
							<ul
								className="relative before:pointer-events-none before:absolute before:inset-y-0.5 before:left-[var(--guide)] before:w-px before:bg-border before:transition-colors has-[>li>[aria-current]]:before:bg-foreground/20"
								style={{ "--guide": `${indentOf(depth) + CHEVRON / 2 - 0.5}px` } as CSSProperties}
							>
								<FolderRows dir={child} depth={depth + 1} folders={folders} file={file} />
							</ul>
						)}
					</li>
				);
			})}
			{dir.files.map(entry => (
				<li key={entry.path}>{file(entry, indentOf(depth) + CHEVRON + 4)}</li>
			))}
		</>
	);
}
