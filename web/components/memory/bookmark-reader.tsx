/** The open bookmark in the Bookmarks tab's reader: a post's whole text with its links, or a page's address and date, and a link that opens it in your browser. */
import { IconCalendar1, IconGlobe, IconSquareArrowTopRight } from "central-icons";
import { Fragment } from "react";
import type { XBookmark, ZenBookmark } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { LINK } from "../settings/editor";
import { MetaRow } from "../sheet-details";
import { hostOf, SiteAddress, SiteIcon } from "../site-icon";

const FULL_DATE = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function fullDate(at: string): string {
	const time = Date.parse(at);
	return Number.isFinite(time) ? FULL_DATE.format(time) : at;
}

function OpenLink({ url, label }: { url: string; label: string }) {
	return (
		<Button variant="outline" size="compact" trailingIcon={IconSquareArrowTopRight} render={<a href={url} target="_blank" rel="noopener noreferrer" {...activityControl("memory.bookmarks.open")} />}>
			{label}
		</Button>
	);
}

export function PageReader({ page }: { page: ZenBookmark }) {
	return (
		<article className="mx-auto max-w-2xl space-y-5 px-8 py-8">
			<span className="flex size-12 items-center justify-center rounded-xl bg-surface-5 shadow-surface-2">
				<SiteIcon hostname={hostOf(page.url)} className="size-6" />
			</span>
			<h2 className="line-clamp-3 text-lg font-semibold text-balance break-words">{page.title}</h2>
			<div className="space-y-1">
				<MetaRow icon={IconGlobe} label="Address">
					<SiteAddress url={page.url} className="block truncate" />
				</MetaRow>
				<MetaRow icon={IconCalendar1} label="Added">
					{fullDate(page.addedAt)}
				</MetaRow>
			</div>
			<OpenLink url={page.url} label="Open page" />
		</article>
	);
}

export function PostReader({ post }: { post: XBookmark }) {
	return (
		<article className="mx-auto max-w-2xl space-y-5 px-8 py-8">
			<header className="flex items-center gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-5 shadow-surface-2">
					<SiteIcon hostname={hostOf(post.url)} className="size-5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-base font-semibold">{post.name}</span>
					<span className="block truncate text-sm text-muted-foreground">{post.handle}</span>
				</span>
			</header>
			{post.text && <PostText text={post.text} className="text-[15px] leading-relaxed" />}
			<p className="text-xs text-muted-foreground">Posted {fullDate(post.addedAt)}</p>
			<OpenLink url={post.url} label="Open on x.com" />
		</article>
	);
}

/** A post's text with its addresses as links. */
function PostText({ text, className }: { text: string; className?: string }) {
	return (
		<p className={cn("whitespace-pre-wrap break-words", className)}>
			{text.split(/(https?:\/\/\S+)/).map((part, at) =>
				at % 2 === 1 ? (
					<a key={at} href={part} target="_blank" rel="noopener noreferrer" className={cn(LINK, "underline decoration-muted-foreground/50")}>
						{part.replace(/^https?:\/\//, "")}
					</a>
				) : (
					<Fragment key={at}>{part}</Fragment>
				),
			)}
		</p>
	);
}
