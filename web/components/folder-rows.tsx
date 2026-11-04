/** `FolderRows`: a folder tree's rows, each folder a button that opens and closes it, which the changes explorer and the settings file rails share. */
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { TreeDir } from "../changes-model";

/** How far a row at `depth` sits from the tree's edge, in pixels; a file's row adds the chevron's width. */
export const indentOf = (depth: number, file = false): number => depth * 12 + (file ? 20 : 4);

/** `dir`'s folders, then its files, as `<li>` rows at `depth`; a folder's rows follow it unless `isShut` says it is closed. The rows take the list's font size. */
export function FolderRows<T extends { path: string }>({
	dir,
	depth,
	isShut,
	onToggle,
	file,
}: {
	dir: TreeDir<T>;
	depth: number;
	isShut: (path: string) => boolean;
	onToggle: (path: string) => void;
	/** A file's `<li>` row at `depth`. */
	file: (file: T, depth: number) => ReactNode;
}) {
	return (
		<>
			{dir.dirs.map(child => {
				const shut = isShut(child.path);
				const Chevron = shut ? ChevronRight : ChevronDown;
				return (
					<Fragment key={child.path}>
						<li>
							<button
								type="button"
								aria-expanded={!shut}
								className="flex w-full items-center gap-1 rounded-md py-0.5 pr-1 text-left text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
								style={{ paddingLeft: indentOf(depth) }}
								onClick={() => onToggle(child.path)}
							>
								<Chevron aria-hidden className="size-3 shrink-0" />
								<Folder aria-hidden className="size-3.5 shrink-0" />
								<span className="truncate">{child.name}</span>
							</button>
						</li>
						{!shut && <FolderRows dir={child} depth={depth + 1} isShut={isShut} onToggle={onToggle} file={file} />}
					</Fragment>
				);
			})}
			{dir.files.map(entry => file(entry, depth))}
		</>
	);
}
