/** `FileTree`: the changes explorer's folder tree of changed files, each with its status letter. */
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ChangedEntry } from "../../../src/shared/changes";
import { foldersAbove, type TreeDir } from "../../changes-model";
import { cn } from "@/lib/utils";
import { LineCounts } from "../line-counts";

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
export function statusLabel(file: ChangedEntry): string {
	const { label } = STATUS[file.status ?? "unlisted"];
	return file.session && file.status !== null ? `${label}; this session edited it` : label;
}

export function StatusLetter({ file }: { file: ChangedEntry }) {
	const look = STATUS[file.status ?? "unlisted"];
	return (
		<span title={statusLabel(file)} className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", look.tone)}>
			{look.letter}
		</span>
	);
}

/** How a file opens: through its address, which a plain click may skip with `onPick`, or in place alone. */
export type FileOpen =
	| { hrefFor: (path: string) => string; onPick?: (path: string) => void }
	| { hrefFor?: undefined; onPick: (path: string) => void };

type FileTreeProps = FileOpen & {
	tree: TreeDir;
	/** The open file's path, highlighted and kept in view. */
	open: string | null;
};

/**
 * The changed files as folders, each folder open until you close it, and opened again when a file in it opens. A dot
 * marks the files a session's own calls changed.
 */
export function FileTree({ tree, open, hrefFor, onPick }: FileTreeProps) {
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const [revealed, setRevealed] = useState(open);
	if (revealed !== open) {
		setRevealed(open);
		const above = new Set(open === null ? [] : (foldersAbove(tree, open) ?? []));
		if ([...closed].some(path => above.has(path))) setClosed(new Set([...closed].filter(path => !above.has(path))));
	}
	const openRow = useRef<HTMLElement | null>(null);
	useEffect(() => {
		openRow.current?.scrollIntoView({ block: "nearest" });
	}, [open]);
	const toggle = (path: string): void =>
		setClosed(prev => {
			const next = new Set(prev);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	const level = (dir: TreeDir, depth: number) => (
		<>
			{dir.dirs.map(child => {
				const shut = closed.has(child.path);
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
				const look = {
					ref: current ? (row: HTMLElement | null) => void (openRow.current = row) : undefined,
					title: `${file.path}: ${statusLabel(file)}`,
					"aria-current": current ? ("page" as const) : undefined,
					className: cn("flex w-full items-center gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs hover:bg-muted", current && "bg-muted font-medium"),
					style: { paddingLeft: depth * 12 + 20 },
				};
				const body = (
					<>
						<FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
						<span className={cn("min-w-0 flex-1 truncate", file.status === "deleted" && "line-through opacity-70")}>{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
						{file.session && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sky-500" />}
						<LineCounts added={file.added} removed={file.removed} />
						<StatusLetter file={file} />
					</>
				);
				return (
					<li key={file.path}>
						{hrefFor ? (
							<a
								{...look}
								href={hrefFor(file.path)}
								onClick={
									onPick &&
									(event => {
										if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
										event.preventDefault();
										onPick(file.path);
									})
								}
							>
								{body}
							</a>
						) : (
							<button type="button" {...look} onClick={() => onPick(file.path)}>
								{body}
							</button>
						)}
					</li>
				);
			})}
		</>
	);
	return <ul>{level(tree, 0)}</ul>;
}
