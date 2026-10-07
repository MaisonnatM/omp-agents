/** Polled lists under a page header. */
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readTime } from "../labels";
import type { PolledEntry } from "../polled-store";
import { Header } from "./page-header";
import { LoadNote } from "./sheet-details";

interface PageFrameProps {
	title: string;
	meta: string;
	/** A control before the title, such as a detail page's way back to its list. */
	leading?: ReactNode;
	/** The header's buttons. */
	actions?: ReactNode;
	/** The page's scrolling content. */
	children: ReactNode;
}

/** A page's frame: its header, then its content, which scrolls under it. */
export function PageFrame({ title, meta, leading, actions, children }: PageFrameProps) {
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta} leading={leading}>
				{actions}
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}

interface DetailPageProps {
	title: string;
	meta: string;
	/** The hash that the header's back arrow goes to, and what its tooltip says. */
	backHref: string;
	backLabel: string;
	/** What the page tells above its content: a quick action's notice, or why the item is not listed. */
	notice?: ReactNode;
	children: ReactNode;
	/** Classes for the column that holds the content: a width other than the reading width. */
	className?: string;
}

/** A page for one item of a list, a pull request or an issue: the frame with a back arrow to the list, `notice`, and the item's content. */
export function DetailPage({ title, meta, backHref, backLabel, notice, children, className }: DetailPageProps) {
	const back = (
		<Tooltip content={backLabel} side="bottom">
			<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={backLabel} render={<a href={backHref} />}>
				<ArrowLeft />
			</Button>
		</Tooltip>
	);
	return (
		<PageFrame title={title} meta={meta} leading={back}>
			<TooltipProvider>
				<div className={cn("mx-auto w-full max-w-5xl space-y-6 px-6 py-6", className)}>
					{notice}
					{children}
				</div>
			</TooltipProvider>
		</PageFrame>
	);
}

interface ListPageProps<Data> {
	title: string;
	/** What the page lists, under its title; the time of the last read follows it once there is one. */
	meta: string;
	/** What the page's load and refresh errors call it: "the tickets". */
	noun: string;
	/** What shows while the first read loads. */
	loading: string;
	poll: PolledEntry<Data>;
	onRefresh: () => void;
	/** What became of the last quick action, above the lists. */
	notice: ReactNode;
	/** Classes for the column that holds the lists: the spacing between them, and a width other than the reading width. */
	className?: string;
	/** Buttons before Refresh. */
	actions?: ReactNode;
	/** What stays pinned under the lists while they scroll. */
	footer?: ReactNode;
	/** The page's lists, from its read. */
	children: (data: Data) => ReactNode;
}

/** A page of lists read from GitHub or Linear with a Refresh button, `notice`, and the lists once the first read loads. */
export function ListPage<Data>({ title, meta, noun, loading, poll, onRefresh, notice, className, actions, footer, children }: ListPageProps<Data>) {
	const { read, error, refreshing } = poll;
	let body: ReactNode;
	if (!read) body = <LoadNote loading={loading} error={error && `Cannot load ${noun}: ${error}`} />;
	else {
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh {noun}: {error}</p>}
				{children(read.data)}
			</>
		);
	}

	return (
		<PageFrame
			title={title}
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<>
					{actions}
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={onRefresh}>
						{refreshing ? "Refreshing…" : "Refresh"}
					</Button>
				</>
			}
		>
			<TooltipProvider>
				<div className={cn("mx-auto w-full max-w-5xl px-6 py-6", className)}>
					{notice}
					{body}
				</div>
				{footer}
			</TooltipProvider>
		</PageFrame>
	);
}
