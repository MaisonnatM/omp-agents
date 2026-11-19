/** The Bookmarks tab's folder tree: every bookmark, the x.com posts, and Zen's folders nested, each with how many bookmarks it holds. */
import { IconAt, IconBookmark, IconFolder1, IconFolderOpen } from "central-icons";
import type { Bookmark } from "../../../src/shared/memory-page";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { type BookmarkPlace, FOLDER_SEPARATOR, folderCounts } from "../../memory-view";

const samePlace = (a: BookmarkPlace, b: BookmarkPlace): boolean => a.kind === b.kind && (a.kind !== "zen" || (b.kind === "zen" && a.path === b.path));

/** The places of `bookmarks`, the ones the search and the source keep; picking one shows only its bookmarks. */
export function BookmarkTree({ bookmarks, place, onPlace }: { bookmarks: readonly Bookmark[]; place: BookmarkPlace; onPlace: (place: BookmarkPlace) => void }) {
	const counts = folderCounts(bookmarks);
	const posts = bookmarks.filter(bookmark => bookmark.source === "x").length;
	const row = (icon: IconComponent, label: string, count: number, depth: number, at: BookmarkPlace) => (
		<TreeRow key={at.kind === "zen" ? `zen:${at.path}` : at.kind} icon={icon} label={label} count={count} depth={depth} picked={samePlace(at, place)} onPick={() => onPlace(at)} />
	);
	const branch = (path: string, depth: number): React.ReactNode[] => [
		row(IconFolder1, path.split(FOLDER_SEPARATOR).at(-1) ?? path, counts.get(path) ?? 0, depth, { kind: "zen", path }),
		...[...counts.keys()]
			.filter(child => child.startsWith(`${path}${FOLDER_SEPARATOR}`) && !child.slice(path.length + FOLDER_SEPARATOR.length).includes(FOLDER_SEPARATOR))
			.sort()
			.flatMap(child => branch(child, depth + 1)),
	];
	return (
		<nav aria-label="Folders" className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
			{row(IconBookmark, "All bookmarks", bookmarks.length, 0, { kind: "all" })}
			{posts > 0 && row(IconAt, "x.com", posts, 0, { kind: "x" })}
			{counts.size > 0 && row(IconFolderOpen, "Zen", bookmarks.length - posts, 0, { kind: "zen", path: "" })}
			{[...counts.keys()]
				.filter(path => !path.includes(FOLDER_SEPARATOR))
				.sort()
				.flatMap(path => branch(path, 1))}
		</nav>
	);
}

function TreeRow({ icon: Icon, label, count, depth, picked, onPick }: { icon: IconComponent; label: string; count: number; depth: number; picked: boolean; onPick: () => void }) {
	return (
		<button
			type="button"
			aria-current={picked || undefined}
			onClick={onPick}
			style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
			className={cn(
				"flex h-7 w-full shrink-0 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
				picked ? "bg-accent font-medium text-foreground hover:bg-accent" : "text-muted-foreground",
			)}
			{...activityControl("memory.bookmarks.folder")}
		>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
		</button>
	);
}
