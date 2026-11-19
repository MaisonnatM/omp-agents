/** The open bookmark in the Bookmarks tab's reader: a post's whole text with its links, or a page's address, folder, and date, and a link that opens it in your browser. */
import { IconCalendar1, IconFolder1, IconGlobe, IconSquareArrowTopRight } from "central-icons";
import { Fragment } from "react";
import type { Bookmark } from "../../../src/shared/memory-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { MetaRow } from "../sheet-details";
import { addressParts, SiteAddress, SiteIcon } from "../site-icon";

const FULL_DATE = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** `url`'s host, `null` for an address the page cannot read. */
export function hostOf(url: string): string | null {
	try {
		return addressParts(url).hostname;
	} catch {
		return null;
	}
}

export function BookmarkReader({ bookmark }: { bookmark: Bookmark }) {
	const added = Date.parse(bookmark.addedAt);
	const when = Number.isFinite(added) ? FULL_DATE.format(added) : bookmark.addedAt;
	const icon = <SiteIcon hostname={hostOf(bookmark.url)} className={bookmark.source === "x" ? "size-5" : "size-6"} />;
	const open = (
		<Button variant="outline" size="compact" trailingIcon={IconSquareArrowTopRight} render={<a href={bookmark.url} target="_blank" rel="noopener noreferrer" {...activityControl("memory.bookmarks.open")} />}>
			{bookmark.source === "x" ? "Open on x.com" : "Open page"}
		</Button>
	);
	if (bookmark.source === "x") {
		return (
			<article className="mx-auto max-w-2xl space-y-5 px-8 py-8">
				<header className="flex items-center gap-3">
					<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-5 shadow-surface-2">{icon}</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-base font-semibold">{bookmark.title}</span>
						<span className="block truncate text-sm text-muted-foreground">{bookmark.author}</span>
					</span>
				</header>
				{bookmark.text && <PostText text={bookmark.text} className="text-[15px] leading-relaxed" />}
				<p className="text-xs text-muted-foreground">Posted {when}</p>
				{open}
			</article>
		);
	}
	return (
		<article className="mx-auto max-w-2xl space-y-5 px-8 py-8">
			<span className="flex size-12 items-center justify-center rounded-xl bg-surface-5 shadow-surface-2">{icon}</span>
			<h2 className="text-xl font-semibold text-balance break-words">{bookmark.title || bookmark.url}</h2>
			<div className="space-y-1">
				<MetaRow icon={IconGlobe} label="Address">
					<SiteAddress url={bookmark.url} className="block truncate" />
				</MetaRow>
				<MetaRow icon={IconFolder1} label="Folder">
					{bookmark.folder ? <Badge size="compact">{bookmark.folder}</Badge> : <span className="text-muted-foreground">None</span>}
				</MetaRow>
				<MetaRow icon={IconCalendar1} label="Added">
					{when}
				</MetaRow>
			</div>
			{open}
		</article>
	);
}

/** A post's text with its addresses as links. */
function PostText({ text, className }: { text: string; className?: string }) {
	return (
		<p className={cn("whitespace-pre-wrap break-words", className)}>
			{text.split(/(https?:\/\/\S+)/).map((part, at) =>
				at % 2 === 1 ? (
					<a key={at} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
						{part.replace(/^https?:\/\//, "")}
					</a>
				) : (
					<Fragment key={at}>{part}</Fragment>
				),
			)}
		</p>
	);
}
