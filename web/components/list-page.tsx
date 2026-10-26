/** Polled lists under a page header. */
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
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
	/** The header's buttons. */
	actions?: ReactNode;
	/** The page's scrolling content. */
	children: ReactNode;
}

/** A page's frame: its header, then its content, which scrolls under it. */
export function PageFrame({ title, meta, actions, children }: PageFrameProps) {
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta}>
				{actions}
			</Header>
			{/* Relative, so an absolute child such as a row's `sr-only` text stays in this scroll and never makes the document scroll. */}
			<div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
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
	notice?: ReactNode;
	/** Classes for the column that holds the lists: the spacing between them, and a width other than the reading width. */
	className?: string;
	/** Buttons before Refresh. */
	actions?: ReactNode;
	/** The page's lists, from its read. */
	children: (data: Data) => ReactNode;
}

/** A page header's Refresh button, which reads the page's data again now. */
function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
	return (
		<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={onRefresh}>
			{refreshing ? "Refreshing…" : "Refresh"}
		</Button>
	);
}

interface PolledContentProps<Data> {
	/** What the load and refresh errors call the data: "the tickets". */
	noun: string;
	/** What shows while the first read loads. */
	loading: string;
	poll: PolledEntry<Data>;
	children: (data: Data) => ReactNode;
}

/** The load note until `poll`'s first read arrives, then its data under why the latest refresh failed, if it did. */
export function PolledContent<Data>({ noun, loading, poll: { read, error }, children }: PolledContentProps<Data>) {
	if (!read) return <LoadNote loading={loading} error={error && `Cannot load ${noun}: ${error}`} />;
	return (
		<>
			{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh {noun}: {error}</p>}
			{children(read.data)}
		</>
	);
}

interface PolledPageFrameProps<Data> {
	title: string;
	/** What the page lists, under its title; the time of the last read follows it once there is one. */
	meta: string;
	poll: PolledEntry<Data>;
	onRefresh: () => void;
	actions?: ReactNode;
	children: ReactNode;
}

/** A polled page's frame: its title and `meta` (with the time of the last read once there is one), its `actions`, a Refresh button, and its `children`. */
export function PolledPageFrame<Data>({ title, meta, poll, onRefresh, actions, children }: PolledPageFrameProps<Data>) {
	const { read, refreshing } = poll;
	return (
		<PageFrame
			title={title}
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<>
					{actions}
					<RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
				</>
			}
		>
			{children}
		</PageFrame>
	);
}

/** A page of lists read from GitHub or Linear with a Refresh button, `notice`, and the lists once the first read loads. */
export function ListPage<Data>({ title, meta, noun, loading, poll, onRefresh, notice, className, actions, children }: ListPageProps<Data>) {
	return (
		<PolledPageFrame title={title} meta={meta} poll={poll} onRefresh={onRefresh} actions={actions}>
			<TooltipProvider>
				<div className={cn("mx-auto w-full max-w-5xl px-6 py-6", className)}>
					{notice}
					<PolledContent noun={noun} loading={loading} poll={poll}>
						{children}
					</PolledContent>
				</div>
			</TooltipProvider>
		</PolledPageFrame>
	);
}

/**
 * Moves keyboard focus by one row in the list `items`, scrolling the new row into view. Returns `true` if focus moved.
 * `rowOf` looks up the row's element by item; each row holds the focusable link. With nothing focused inside the list,
 * the focus enters the list only when `entersList` (default `true`); false leaves the row unchanged.
 */
export function stepRows<T>(items: readonly T[], rowOf: (item: T) => HTMLElement | null, by: 1 | -1, entersList = true): boolean {
	const active = document.activeElement;
	const at = items.findIndex(item => rowOf(item)?.contains(active) ?? false);
	const next = at >= 0 ? items[at + by] : entersList ? items[by === 1 ? 0 : items.length - 1] : undefined;
	if (!next) return at >= 0;
	const row = rowOf(next);
	return (row !== null && focusRow(row)) || at >= 0;
}

/** Focuses `row`'s link and scrolls the row into view in its list. Returns `false` when the row holds no link. */
export function focusRow(row: HTMLElement): boolean {
	const link = row.querySelector("a");
	if (!link) return false;
	link.focus({ preventScroll: true });
	row.scrollIntoView({ block: "nearest" });
	return true;
}

/**
 * Saves `target`'s `keyOf` on a change, and on the next change to `null` focuses the matching row, or `fallback` when
 * the row is not mounted yet. `ready` is the dependency that gates the second focus pass (a polled read that has the
 * data). `rowLink` looks up the row's focusable link by key.
 */
export function useReturnFocus<T>(target: T | null, keyOf: (target: T) => string, rowLink: (key: string) => HTMLElement | null | undefined, ready: unknown, fallback?: () => HTMLElement | null): void {
	const returnTo = useRef<string | null>(null);
	useEffect(() => {
		if (target !== null) returnTo.current = keyOf(target);
	}, [target]);
	useEffect(() => {
		if (target !== null || returnTo.current === null) return;
		const destination = rowLink(returnTo.current) ?? fallback?.() ?? null;
		if (!destination) return;
		destination.focus();
		returnTo.current = null;
	}, [target, ready]);
}
