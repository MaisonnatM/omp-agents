/**
 * The Bookmarks tab's places: every bookmark, the x.com posts, and Zen's folders nested, each with how many bookmarks it holds.
 * A wide tab lists them as a tree beside the list; a narrow one folds them into a picker in the toolbar.
 */
import { IconAt, IconBookmark, IconFolder1, IconFolderOpen } from "central-icons";
import type { Bookmark } from "../../../src/shared/memory-page";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { CommandPicker } from "../command-picker";
import { type BookmarkPlace, folderTree, samePlace, treeRows } from "./bookmarks-view";

interface PlacesProps {
	/** The bookmarks the search keeps, which the counts count. */
	bookmarks: readonly Bookmark[];
	place: BookmarkPlace;
	onPlace: (place: BookmarkPlace) => void;
}

interface PlaceRow {
	key: string;
	place: BookmarkPlace;
	label: string;
	icon: IconComponent;
	count: number;
	depth: number;
}

function placeRows(bookmarks: readonly Bookmark[]): PlaceRow[] {
	const posts = bookmarks.filter(bookmark => bookmark.source === "x").length;
	const pages = bookmarks.length - posts;
	const rows: PlaceRow[] = [{ key: "all", place: { kind: "all" }, label: "All bookmarks", icon: IconBookmark, count: bookmarks.length, depth: 0 }];
	if (posts > 0) rows.push({ key: "x", place: { kind: "x" }, label: "x.com", icon: IconAt, count: posts, depth: 0 });
	if (pages === 0) return rows;
	rows.push({ key: "zen", place: { kind: "zen", folder: [] }, label: "Zen", icon: IconFolderOpen, count: pages, depth: 0 });
	for (const { node, depth } of treeRows(folderTree(bookmarks))) {
		rows.push({ key: `zen:${node.folder.join("\n")}`, place: { kind: "zen", folder: node.folder }, label: node.name, icon: IconFolder1, count: node.count, depth: depth + 1 });
	}
	return rows;
}

/** The places as a tree, shown on a tab at least `@4xl` wide. */
export function BookmarkTree({ bookmarks, place, onPlace }: PlacesProps) {
	return (
		<nav aria-label="Folders" className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 @4xl:flex">
			{placeRows(bookmarks).map(row => {
				const picked = samePlace(row.place, place);
				return (
					<button
						key={row.key}
						type="button"
						aria-current={picked || undefined}
						onClick={() => onPlace(row.place)}
						style={{ paddingLeft: `${0.5 + row.depth * 0.875}rem` }}
						className={cn(
							"flex h-7 w-full shrink-0 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
							picked ? "bg-accent font-medium text-foreground hover:bg-accent" : "text-muted-foreground",
						)}
						{...activityControl("memory.bookmarks.folder")}
					>
						<row.icon aria-hidden className="size-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{row.label}</span>
						<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.count}</span>
					</button>
				);
			})}
		</nav>
	);
}

/** The places as a picker, shown in the toolbar on a tab narrower than `@4xl`, where the tree is hidden. */
export function BookmarkPlacePicker({ bookmarks, place, onPlace }: PlacesProps) {
	const rows = placeRows(bookmarks);
	const current = rows.find(row => samePlace(row.place, place)) ?? rows[0]!;
	return (
		<CommandPicker
			trigger={<span className="max-w-40 truncate">{current.label}</span>}
			icon={current.icon}
			ariaLabel={`Folder: ${current.label}`}
			search={{ label: "Search folders" }}
			width="md"
			className="@4xl:hidden"
			control="memory.bookmarks.folder"
			list={{
				kind: "ready",
				groups: [
					{
						key: "places",
						items: rows.map(row => ({
							value: row.key,
							keywords: [row.label],
							icon: row.icon,
							label: (
								<span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${row.depth * 0.75}rem` }}>
									<span className="min-w-0 flex-1 truncate">{row.label}</span>
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.count}</span>
								</span>
							),
							selected: row === current,
							onSelect: () => onPlace(row.place),
						})),
					},
				],
			}}
		/>
	);
}
