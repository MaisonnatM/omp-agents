/**
 * The Memory page's Bookmarks tab: your Zen and x.com bookmarks, searched, with the places they sit in as a tree on the left,
 * the bookmarks of the place picked in the middle under a header per folder, and the open one read on the right.
 */
import { IconArrowRotateClockwise, IconBookmark } from "central-icons";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { type Bookmark, type BookmarksView, bookmarkMatcher, type XSyncState } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { activityControl } from "../../activity";
import { BOOKMARKS_URL, syncXBookmarks } from "../../api";
import { useEditableRead } from "../../editable-read";
import { useShortcuts } from "../../shortcuts";
import { Age } from "../age";
import { useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { ErrorText, useSaving } from "../settings/editor";
import { LoadNote } from "../sheet-details";
import { BookmarkList } from "./bookmark-list";
import { PageReader, PostReader } from "./bookmark-reader";
import { BookmarkPlacePicker, BookmarkTree } from "./bookmark-tree";
import { type BookmarkPlace, bookmarkGroups, inPlace } from "./bookmarks-view";
import { memoryHash } from "./tabs";

/** The most rows the list draws at once; a search narrows the rest. */
const SHOWN_MAX = 300;

/** `q` is the search the address holds, its one owner: typing replaces the address without adding to its history. */
export function BookmarksTab({ q }: { q: string }) {
	const view = useEditableRead<BookmarksView>(BOOKMARKS_URL);
	const [place, setPlace] = useState<BookmarkPlace>({ kind: "all" });
	const [openId, setOpenId] = useState<string | null>(null);
	const rows = useRef(new Map<string, HTMLButtonElement>()).current;
	const sync = useSaving<"sync">();
	const found = useMemo(() => view.data?.bookmarks.filter(bookmarkMatcher(q)) ?? [], [view.data, q]);
	const picked = useMemo(() => found.filter(bookmark => inPlace(place, bookmark)), [found, place]);
	const groups = useMemo(() => bookmarkGroups(picked, SHOWN_MAX), [picked]);
	const listed = useMemo(() => groups.flatMap(group => group.bookmarks), [groups]);
	const at = openId === null ? -1 : listed.findIndex(bookmark => bookmark.id === openId);
	const open = listed[at] ?? null;
	useReturnFocus(open?.id ?? null, id => id, id => rows.get(id), listed);
	const show = (bookmark: Bookmark | undefined): void => {
		if (!bookmark) return;
		const row = rows.get(bookmark.id);
		row?.focus({ preventScroll: true });
		row?.scrollIntoView({ block: "nearest" });
		if (open) setOpenId(bookmark.id);
	};
	const step = (by: 1 | -1): void => {
		if (open) return show(listed[at + by]);
		const focused = listed.findIndex(bookmark => rows.get(bookmark.id) === document.activeElement);
		show(focused < 0 ? listed[by === 1 ? 0 : listed.length - 1] : listed[focused + by]);
	};
	useShortcuts({ memoryBookmarksNext: () => step(1), memoryBookmarksPrevious: () => step(-1), memoryBookmarksClose: () => setOpenId(null) });
	if (view.data === null) {
		return (
			<div className="px-6 py-6">
				<LoadNote loading="Reading your bookmarks…" error={view.error && `Cannot read your bookmarks: ${view.error}`} />
			</div>
		);
	}
	const { bookmarks, zenFound, x } = view.data;
	const list =
		listed.length === 0 ? (
			<p className="px-4 py-4 text-sm text-muted-foreground">{bookmarks.length === 0 ? "No bookmarks yet." : "No bookmark matches."}</p>
		) : (
			<>
				<BookmarkList groups={groups} openId={open?.id ?? null} onOpen={setOpenId} rows={rows} />
				{picked.length > SHOWN_MAX && (
					<p className="px-4 pb-4 text-xs text-muted-foreground">
						Showing {SHOWN_MAX.toLocaleString()} of {picked.length.toLocaleString()}. Search to narrow them.
					</p>
				)}
			</>
		);
	return (
		<div className="@container flex h-full min-h-0 flex-col">
			<BookmarksToolbar
				q={q}
				picker={<BookmarkPlacePicker bookmarks={found} place={place} onPlace={setPlace} />}
				count={picked.length}
				total={bookmarks.length}
				notes={
					<>
						{!zenFound && <span>Zen's profile was not found, so no Zen bookmark shows.</span>}
						{sync.error && <ErrorText>Cannot sync x.com: {sync.error}</ErrorText>}
						<XStatus x={x} />
					</>
				}
				syncing={sync.saving === "sync"}
				onSync={() => sync.run("sync", () => view.write(syncXBookmarks))}
			/>
			<div className="flex min-h-0 flex-1">
				<BookmarkTree bookmarks={found} place={place} onPlace={setPlace} />
				<div className="min-w-0 flex-1">
					<ListSplit
						widthKey="omp-agents.bookmarks-list-width"
						resizeLabel="Resize the bookmark list"
						detailLabel="Open bookmark"
						empty={{ icon: IconBookmark, title: "No bookmark open", hint: "Pick a bookmark to read it here." }}
						list={list}
						detail={
							open && (
								<section key={open.id} aria-label={open.source === "x" ? `${open.name}'s post` : open.title || open.url}>
									<DetailBar
										leading={open.source === "x" ? "x.com post" : open.folder.join(" / ") || "Zen"}
										previous={{ label: "Previous bookmark", icon: CH_PREVIOUS, shortcut: "memoryBookmarksPrevious", onClick: at > 0 ? () => step(-1) : undefined }}
										next={{ label: "Next bookmark", icon: CH_NEXT, shortcut: "memoryBookmarksNext", onClick: at < listed.length - 1 ? () => step(1) : undefined }}
										close={{ label: "Close", icon: CH_CLOSE, shortcut: "memoryBookmarksClose", onClick: () => setOpenId(null) }}
									/>
									{open.source === "x" ? <PostReader post={open} /> : <PageReader page={open} />}
								</section>
							)
						}
					/>
				</div>
			</div>
		</div>
	);
}

interface BookmarksToolbarProps {
	q: string;
	picker: ReactNode;
	count: number;
	total: number;
	notes: ReactNode;
	syncing: boolean;
	onSync: () => void;
}

function BookmarksToolbar({ q, picker, count, total, notes, syncing, onSync }: BookmarksToolbarProps) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
			<SearchField label="Search bookmarks" placeholder="Search" query={q} onQuery={next => location.replace(memoryHash({ tab: "bookmarks", q: next }))} className="w-36 min-w-0" />
			{picker}
			<span className="text-xs text-muted-foreground tabular-nums">{count === total ? total.toLocaleString() : `${count.toLocaleString()} of ${total.toLocaleString()}`}</span>
			<div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{notes}
				<Button variant="ghost" size="compact" leadingIcon={IconArrowRotateClockwise} disabled={syncing} loading={syncing} onClick={onSync} {...activityControl("memory.bookmarks.sync")}>
					Sync x.com
				</Button>
			</div>
		</div>
	);
}

/** When the x.com posts shown were read, and why the last sync failed, if it did. */
function XStatus({ x }: { x: XSyncState }) {
	const synced = x.syncedAt && (
		<span>
			x.com: synced <Age at={Date.parse(x.syncedAt)} exact className="tabular-nums" /> ago
		</span>
	);
	if (x.error !== null) {
		return (
			<>
				{synced}
				<ErrorText>x.com: {x.error}</ErrorText>
			</>
		);
	}
	if (!x.signedIn) return <span>x.com: sign in to x.com in Zen to see your x.com bookmarks here.</span>;
	return synced || <span>x.com: not synced yet.</span>;
}
