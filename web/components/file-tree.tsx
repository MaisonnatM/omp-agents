import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { foldersAbove, type TreeDir } from "../file-tree";
import { cn } from "@/lib/utils";

/** What a file's row shows besides its name: its tooltip, a class for its name, and what follows the name. */
export interface FileDecoration {
	title: string;
	nameClassName?: string;
	trailing?: ReactNode;
}

const plain = (file: { path: string }): FileDecoration => ({ title: file.path });

/** `set` with each of `paths` added when it is missing and dropped when it is there. */
function flipped(set: ReadonlySet<string>, paths: readonly string[]): ReadonlySet<string> {
	const next = new Set(set);
	for (const path of paths) if (!next.delete(path)) next.add(path);
	return next;
}

interface FileTreeProps<F extends { path: string }> {
	tree: TreeDir<F>;
	/** The open file's path, highlighted and kept in view. */
	open: string | null;
	/** The address that opens the file at `path`. */
	hrefFor: (path: string) => string;
	/** Opens the file at `path` in place on a plain click, which then leaves the address alone. */
	onPick?: (path: string) => void;
	/** Every folder starts closed, for a list too long to show whole; otherwise every folder starts open. */
	startClosed?: boolean;
	/** By default a row's tooltip is its path and nothing follows its name. */
	decorate?: (file: F) => FileDecoration;
}

/** Files as folders, each folder open or closed until you click it, and opened when a file in it opens. */
export function FileTree<F extends { path: string }>({ tree, open, hrefFor, onPick, startClosed = false, decorate = plain }: FileTreeProps<F>) {
	// The folders clicked away from how they start.
	const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
	// The `startClosed` that `toggled` is relative to; a new one starts every folder over.
	const [togglesFrom, setTogglesFrom] = useState(startClosed);
	// `null` at first, so a file open from the start opens its folders too.
	const [revealed, setRevealed] = useState<string | null>(null);
	const isShut = (path: string): boolean => startClosed !== toggled.has(path);
	if (togglesFrom !== startClosed) {
		setTogglesFrom(startClosed);
		setToggled(new Set());
		setRevealed(null);
	} else if (revealed !== open) {
		setRevealed(open);
		const shut = (open === null ? [] : (foldersAbove(tree, open) ?? [])).filter(isShut);
		if (shut.length > 0) setToggled(flipped(toggled, shut));
	}
	const openRow = useRef<HTMLAnchorElement>(null);
	useEffect(() => {
		openRow.current?.scrollIntoView({ block: "nearest" });
	}, [open]);
	const toggle = (path: string): void => setToggled(prev => flipped(prev, [path]));
	const level = (dir: TreeDir<F>, depth: number) => (
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
								className="flex w-full items-center gap-1 rounded-md py-0.5 pr-1 text-left text-xs text-muted-foreground hover:bg-muted"
								style={{ paddingLeft: depth * 12 + 4 }}
								onClick={() => toggle(child.path)}
							>
								<Chevron aria-hidden className="size-3 shrink-0" />
								<Folder aria-hidden className="size-3.5 shrink-0" />
								<span className="truncate">{child.name}</span>
							</button>
						</li>
						{!shut && level(child, depth + 1)}
					</Fragment>
				);
			})}
			{dir.files.map(file => {
				const current = file.path === open;
				const { title, nameClassName, trailing } = decorate(file);
				return (
					<li key={file.path}>
						<a
							ref={current ? openRow : undefined}
							href={hrefFor(file.path)}
							title={title}
							onClick={
								onPick &&
								(event => {
									if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
									event.preventDefault();
									onPick(file.path);
								})
							}
							aria-current={current ? "page" : undefined}
							className={cn("flex w-full items-center gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs hover:bg-muted", current && "bg-muted font-medium")}
							style={{ paddingLeft: depth * 12 + 20 }}
						>
							<FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
							<span className={cn("min-w-0 flex-1 truncate", nameClassName)}>{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
							{trailing}
						</a>
					</li>
				);
			})}
		</>
	);
	return <ul>{level(tree, 0)}</ul>;
}

/** A file's path as breadcrumbs above its code, its name last; `title` is its tooltip. */
export function PathCrumbs({ path, title }: { path: string; title: string }) {
	return (
		<p className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs text-muted-foreground" title={title}>
			{path.split("/").map((part, index, parts) => (
				<Fragment key={index}>
					{index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" />}
					<span className={index === parts.length - 1 ? "truncate text-foreground" : "shrink-0"}>{part}</span>
				</Fragment>
			))}
		</p>
	);
}
