/**
 * The Memory page's Bookmarks tab: your Zen and x.com bookmarks, searched and filtered by source, with Zen's folders as a tree on the left,
 * the bookmarks of the place picked in the middle under a header per folder, and the open one read on the right.
 */
import { IconArrowRotateClockwise, IconAt, IconBookmark, IconFolder1 } from "central-icons";
import { type KeyboardEvent, useMemo, useState } from "react";
import type { Bookmark, BookmarksView, XSyncState } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { BOOKMARKS_URL, syncXBookmarks } from "../../api";
import { useEditableRead } from "../../editable-read";
import { dayLabel } from "../../labels";
import { type BookmarkFilter, type BookmarkPlace, bookmarkGroups, filterBookmarks, inPlace, X_GROUP } from "../../memory-view";
import { Age } from "../age";
import { CountPill } from "../count-pill";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { ErrorText, useSaving } from "../settings/editor";
import { LoadNote } from "../sheet-details";
import { SiteIcon } from "../site-icon";
import { BookmarkReader, hostOf } from "./bookmark-reader";
import { BookmarkTree } from "./bookmark-tree";
import { memoryHash } from "./tabs";

/** The most rows the list draws at once; a search narrows the rest. */
const SHOWN_MAX = 300;

const SOURCES: { value: BookmarkFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "zen", label: "Zen" },
	{ value: "x", label: "x.com" },
];

/** `q` is the search the address holds; typing keeps it there without adding to the address's history. */
export function BookmarksTab({ q }: { q: string }) {
	const view = useEditableRead<BookmarksView>(BOOKMARKS_URL);
	const [query, setQuery] = useState(q);
	const [source, setSource] = useState<BookmarkFilter>("all");
	const [place, setPlace] = useState<BookmarkPlace>({ kind: "all" });
	/** The open bookmark's id; `undefined` opens the first one listed, `null` none. */
	const [openId, setOpenId] = useState<string | null | undefined>(undefined);
	const sync = useSaving<"sync">();
	const shown = useMemo(() => (view.data ? filterBookmarks(view.data.bookmarks, query, source) : []), [view.data, query, source]);
	const picked = useMemo(() => shown.filter(bookmark => inPlace(place, bookmark)), [shown, place]);
	const groups = useMemo(() => bookmarkGroups(picked.slice(0, SHOWN_MAX)), [picked]);
	if (view.data === null) {
		return (
			<div className="px-6 py-6">
				<LoadNote loading="Reading your bookmarks…" error={view.error && `Cannot read your bookmarks: ${view.error}`} />
			</div>
		);
	}
	const { bookmarks, zenFound, x } = view.data;
	const listed = groups.flatMap(group => group.bookmarks);
	const at = openId === undefined ? (listed.length > 0 ? 0 : -1) : listed.findIndex(bookmark => bookmark.id === openId);
	const open = listed[at] ?? null;
	const search = (next: string): void => {
		setQuery(next);
		history.replaceState(null, "", memoryHash({ tab: "bookmarks", q: next }));
	};
	const step = (by: 1 | -1): void => {
		const next = listed[at + by];
		if (!next) return;
		setOpenId(next.id);
		document.getElementById(`bookmark-${next.id}`)?.scrollIntoView({ block: "nearest" });
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		step(event.key === "ArrowDown" ? 1 : -1);
	};
	const list =
		listed.length === 0 ? (
			<p className="px-4 py-4 text-sm text-muted-foreground">{bookmarks.length === 0 ? "No bookmarks yet." : "No bookmark matches."}</p>
		) : (
			<>
				<div role="listbox" aria-label="Bookmarks" tabIndex={0} onKeyDown={onKeyDown} className="outline-none">
					{groups.map(group => (
						<div key={group.name} role="group" aria-label={group.name}>
							{groups.length > 1 && (
								<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 text-xs font-medium backdrop-blur">
									{group.name === X_GROUP ? <IconAt aria-hidden className="size-3.5 text-muted-foreground" /> : <IconFolder1 aria-hidden className="size-3.5 text-muted-foreground" />}
									<span className="truncate">{group.name}</span>
									<CountPill count={group.bookmarks.length} />
								</div>
							)}
							<div className="flex flex-col gap-px p-2">
								{group.bookmarks.map(bookmark => (
									<BookmarkRow key={bookmark.id} bookmark={bookmark} selected={bookmark.id === open?.id} onSelect={() => setOpenId(bookmark.id)} />
								))}
							</div>
						</div>
					))}
				</div>
				{picked.length > SHOWN_MAX && (
					<p className="px-4 pb-4 text-xs text-muted-foreground">
						Showing the newest {SHOWN_MAX.toLocaleString()} of {picked.length.toLocaleString()}. Search to narrow them.
					</p>
				)}
			</>
		);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
				<SearchField label="Search bookmarks" placeholder="Search" query={query} onQuery={search} className="w-56 min-w-0" />
				<SegmentedTabs value={source} onValueChange={next => setSource(next as BookmarkFilter)}>
					<SegmentedTabsList aria-label="Source">
						{SOURCES.map(({ value, label }) => (
							<SegmentedTab key={value} value={value} {...activityControl("memory.bookmarks.source")}>
								{label}
							</SegmentedTab>
						))}
					</SegmentedTabsList>
				</SegmentedTabs>
				<span className="text-xs text-muted-foreground tabular-nums">
					{picked.length === bookmarks.length ? bookmarks.length.toLocaleString() : `${picked.length.toLocaleString()} of ${bookmarks.length.toLocaleString()}`}
				</span>
				<div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{!zenFound && <span>Zen's profile was not found, so no Zen bookmark shows.</span>}
					{sync.error && <ErrorText>Cannot sync x.com: {sync.error}</ErrorText>}
					<XStatus x={x} />
					<Button
						variant="ghost"
						size="compact"
						leadingIcon={IconArrowRotateClockwise}
						disabled={sync.saving !== null}
						loading={sync.saving === "sync"}
						onClick={() => sync.run("sync", () => view.write(syncXBookmarks))}
						{...activityControl("memory.bookmarks.sync")}
					>
						Sync x.com
					</Button>
				</div>
			</div>
			<div className="flex min-h-0 flex-1">
				<BookmarkTree bookmarks={shown} place={place} onPlace={setPlace} />
				<div className="min-w-0 flex-1">
					<ListSplit
						widthKey="omp-agents.bookmarks-list-width"
						resizeLabel="Resize the bookmark list"
						detailLabel="Open bookmark"
						empty={{ icon: IconBookmark, title: "No bookmark open", hint: "Click a bookmark to read it here." }}
						list={list}
						detail={
							open && (
								<section key={open.id} aria-label={open.title || open.url}>
									<DetailBar
										leading={open.source === "x" ? "x.com post" : (open.folder ?? "Zen")}
										previous={{ label: "Previous bookmark", icon: CH_PREVIOUS, onClick: at > 0 ? () => step(-1) : undefined }}
										next={{ label: "Next bookmark", icon: CH_NEXT, onClick: at < listed.length - 1 ? () => step(1) : undefined }}
										close={{ label: "Close", icon: CH_CLOSE, onClick: () => setOpenId(null) }}
									/>
									<BookmarkReader bookmark={open} />
								</section>
							)
						}
					/>
				</div>
			</div>
		</div>
	);
}

/** When the x.com bookmarks were last read, or why they could not be. */
function XStatus({ x }: { x: XSyncState }) {
	if (x.error !== null) {
		return (
			<span role="alert" className="text-red-600 dark:text-red-400">
				x.com: {x.error}
			</span>
		);
	}
	if (!x.signedIn) return <span>x.com: sign in to x.com in Zen to see your x.com bookmarks here.</span>;
	if (x.syncedAt === null) return <span>x.com: not synced yet.</span>;
	return (
		<span>
			x.com: synced <Age at={Date.parse(x.syncedAt)} exact className="tabular-nums" /> ago
		</span>
	);
}

/** A bookmark in the list: its site's icon, its title or author, the post's start or the page's site, and its date. */
function BookmarkRow({ bookmark, selected, onSelect }: { bookmark: Bookmark; selected: boolean; onSelect: () => void }) {
	const host = hostOf(bookmark.url);
	return (
		<div
			id={`bookmark-${bookmark.id}`}
			role="option"
			aria-selected={selected}
			onClick={onSelect}
			className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent/50", selected && "bg-accent hover:bg-accent")}
		>
			<SiteIcon hostname={host} className="mt-0.5 size-4" />
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-2">
					<span className="min-w-0 flex-1 truncate text-sm font-medium">{bookmark.title || bookmark.url}</span>
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{dayLabel(bookmark.addedAt)}</span>
				</span>
				<span className="line-clamp-2 text-xs text-muted-foreground">
					{bookmark.source === "x" ? `${bookmark.author ?? ""} · ${bookmark.text ?? ""}` : (host?.replace(/^www\./, "") ?? bookmark.url)}
				</span>
			</span>
		</div>
	);
}
