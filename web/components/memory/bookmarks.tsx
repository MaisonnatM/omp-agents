/** The Memory page's Bookmarks tab: your Zen and x.com bookmarks, searched and filtered by source, each opening in your browser. */
import { IconArrowRotateClockwise } from "central-icons";
import { useMemo, useState } from "react";
import type { Bookmark, BookmarksView, XSyncState } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { activityControl } from "../../activity";
import { BOOKMARKS_URL, syncXBookmarks } from "../../api";
import { useEditableRead } from "../../editable-read";
import { DAY_FORMAT } from "../../labels";
import { type BookmarkFilter, filterBookmarks } from "../../memory-view";
import { Age } from "../age";
import { SearchField } from "../search-field";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { ErrorText, useSaving } from "../settings/editor";
import { LoadNote } from "../sheet-details";
import { addressParts, SiteAddress, SiteIcon } from "../site-icon";
import { memoryHash } from "./tabs";

/** The most rows the list draws at once; a search narrows the rest. */
const SHOWN_MAX = 300;

const SOURCES: { value: BookmarkFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "zen", label: "Zen" },
	{ value: "x", label: "x.com" },
];

/** `url`'s host, `null` for an address the page cannot read. */
function hostOf(url: string): string | null {
	try {
		return addressParts(url).hostname;
	} catch {
		return null;
	}
}

/** `q` is the search the address holds, which typing keeps in the address without adding to its history. */
export function BookmarksTab({ q }: { q: string }) {
	const view = useEditableRead<BookmarksView>(BOOKMARKS_URL);
	const [query, setQuery] = useState(q);
	const [source, setSource] = useState<BookmarkFilter>("all");
	const sync = useSaving<"sync">();
	const shown = useMemo(() => (view.data ? filterBookmarks(view.data.bookmarks, query, source) : []), [view.data, query, source]);
	const search = (next: string): void => {
		setQuery(next);
		history.replaceState(null, "", memoryHash({ tab: "bookmarks", q: next }));
	};
	if (view.data === null) {
		return (
			<div className="px-6 py-6">
				<LoadNote loading="Reading your bookmarks…" error={view.error && `Cannot read your bookmarks: ${view.error}`} />
			</div>
		);
	}
	const { bookmarks, zenFound, x } = view.data;
	return (
		<div className="mx-auto w-full max-w-4xl space-y-3 px-6 py-4">
			<div className="flex flex-wrap items-center gap-2">
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
				<p className="ml-auto text-xs text-muted-foreground tabular-nums">
					{shown.length === bookmarks.length ? bookmarks.length.toLocaleString() : `${shown.length.toLocaleString()} of ${bookmarks.length.toLocaleString()}`}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
				{!zenFound && <span>Zen's profile was not found, so no Zen bookmark shows.</span>}
			</div>
			{sync.error && <ErrorText>Cannot sync x.com: {sync.error}</ErrorText>}
			{shown.length === 0 ? (
				<p className="py-4 text-sm text-muted-foreground">{bookmarks.length === 0 ? "No bookmarks yet." : "No bookmark matches."}</p>
			) : (
				<ul className="flex flex-col gap-0.5">
					{shown.slice(0, SHOWN_MAX).map(bookmark => (
						<BookmarkRow key={bookmark.id} bookmark={bookmark} />
					))}
				</ul>
			)}
			{shown.length > SHOWN_MAX && (
				<p className="text-xs text-muted-foreground">
					Showing the newest {SHOWN_MAX.toLocaleString()} of {shown.length.toLocaleString()}. Search to narrow them.
				</p>
			)}
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

/** A bookmark as a link that opens in your browser: the site's icon, its title, then its folder and address, or a post's author and text, and its date. */
function BookmarkRow({ bookmark }: { bookmark: Bookmark }) {
	const added = Date.parse(bookmark.addedAt);
	return (
		<li>
			<a
				href={bookmark.url}
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-start gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
				{...activityControl("memory.bookmarks.open")}
			>
				<SiteIcon hostname={hostOf(bookmark.url)} className="mt-0.5 size-4" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">{bookmark.title || bookmark.url}</span>
					{bookmark.source === "x" ? (
						<>
							{bookmark.author && <span className="block truncate text-xs text-muted-foreground">{bookmark.author}</span>}
							{bookmark.text && <span className="line-clamp-2 text-xs text-foreground/80">{bookmark.text}</span>}
						</>
					) : (
						<span className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
							{bookmark.folder && <span className="max-w-1/2 shrink-0 truncate">{bookmark.folder}</span>}
							<SiteAddress url={bookmark.url} className="truncate" />
						</span>
					)}
				</span>
				{Number.isFinite(added) && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{DAY_FORMAT.format(added)}</span>}
			</a>
		</li>
	);
}
