/** The Bookmarks tab's list: the bookmarks of the place picked under a header per folder, each row opening its bookmark in the reader. */
import { IconAt, IconFolder1 } from "central-icons";
import type { XBookmark, ZenBookmark } from "../../../src/shared/memory-page";
import { cn } from "@/lib/utils";
import { dayLabel } from "../../labels";
import { CountPill } from "../count-pill";
import { hostOf, SiteIcon } from "../site-icon";
import type { BookmarkGroup } from "./bookmarks-view";

interface BookmarkListProps {
	groups: readonly BookmarkGroup[];
	openId: string | null;
	onOpen: (id: string) => void;
	/** Each mounted row's button by its bookmark's id, which the tab's ↓ and ↑ focus. */
	rows: Map<string, HTMLButtonElement>;
}

export function BookmarkList({ groups, openId, onOpen, rows }: BookmarkListProps) {
	return groups.map(group => (
		<section key={`${group.source}:${group.name}`} aria-label={group.name}>
			{groups.length > 1 && (
				<h3 className="sticky top-0 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 text-xs font-medium backdrop-blur">
					{group.source === "x" ? <IconAt aria-hidden className="size-3.5 text-muted-foreground" /> : <IconFolder1 aria-hidden className="size-3.5 text-muted-foreground" />}
					<span className="truncate">{group.name}</span>
					<CountPill count={group.count} />
				</h3>
			)}
			<ul className="flex flex-col gap-px p-2">
				{group.bookmarks.map(bookmark => {
					const open = bookmark.id === openId;
					return (
						<li key={bookmark.id}>
							<button
								type="button"
								ref={element => {
									if (element) rows.set(bookmark.id, element);
									return () => {
										rows.delete(bookmark.id);
									};
								}}
								aria-current={open || undefined}
								onClick={() => onOpen(bookmark.id)}
								className={cn(
									"flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
									open && "bg-accent hover:bg-accent",
								)}
							>
								{bookmark.source === "x" ? <PostRow post={bookmark} /> : <PageRow page={bookmark} />}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	));
}

function RowTop({ url, title, at }: { url: string; title: string; at: string }) {
	return (
		<>
			<SiteIcon hostname={hostOf(url)} className="mt-0.5 size-4" />
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
				<span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{dayLabel(at)}</span>
			</span>
		</>
	);
}

/** A Zen page: its title, its date, and its site. */
function PageRow({ page }: { page: ZenBookmark }) {
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="flex items-start gap-2.5">
				<RowTop url={page.url} title={page.title} at={page.addedAt} />
			</span>
			<span className="truncate pl-6.5 text-xs text-muted-foreground">{hostOf(page.url)?.replace(/^www\./, "") ?? page.url}</span>
		</span>
	);
}

/** An x.com post: its author, its date, and its text's start. */
function PostRow({ post }: { post: XBookmark }) {
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="flex items-start gap-2.5">
				<RowTop url={post.url} title={post.name} at={post.addedAt} />
			</span>
			<span className="line-clamp-2 pl-6.5 text-xs text-muted-foreground">
				{post.handle} · {post.translation ?? post.text}
			</span>
		</span>
	);
}
