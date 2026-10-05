/** Polled lists under a page header, with an optional target details sheet. */
import { RefreshCw } from "lucide-react";
import { type ReactNode, type Ref, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readTime } from "../labels";
import type { PolledEntry } from "../polled-store";
import { Header } from "./conversation";

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
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header title={title} meta={meta}>
				{actions}
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}

interface ListSheetPageProps<Data> {
	title: string;
	/** What the page lists, under its title; the time of the last read follows it once there is one. */
	meta: string;
	/** What the page's load and refresh errors call it: "the inbox". */
	noun: string;
	/** What shows while the first read loads. */
	loading: string;
	poll: PolledEntry<Data>;
	onRefresh: () => void;
	/** Why the page does not list the target a link named, shown once read; `null` when it lists it or no link named one. */
	missing: string | null;
	/** What became of the last quick action, above the lists. */
	notice: ReactNode;
	/** The spacing between the page's lists: a `space-y-*` class. */
	spacing: string;
	/** The page's lists, from its read. */
	children: (data: Data) => ReactNode;
	/** The sheet with a target's details, which renders after the lists, inside the page's `TooltipProvider`. */
	sheet?: ReactNode;
	/** Focus returns here when the lists are not mounted. */
	contentRef?: Ref<HTMLDivElement>;
}

/**
 * A page of lists read from GitHub or Linear with a Refresh button, `notice`, the lists once the first read loads,
 * and an optional details sheet.
 */
export function ListSheetPage<Data>({ title, meta, noun, loading, poll, onRefresh, missing, notice, spacing, children, sheet, contentRef }: ListSheetPageProps<Data>) {
	const { read, error, refreshing } = poll;
	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load {noun}: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">{loading}</p>;
	else {
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh {noun}: {error}</p>}
				{missing && (
					<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
						{missing}
					</p>
				)}
				{children(read.data)}
			</>
		);
	}

	return (
		<PageFrame
			title={title}
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={onRefresh}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			}
		>
			<TooltipProvider>
				<div ref={contentRef} tabIndex={contentRef ? -1 : undefined} className={cn("mx-auto w-full max-w-5xl px-6 py-6", contentRef && "outline-none focus-visible:ring-2 focus-visible:ring-ring", spacing)}>
					{notice}
					{body}
				</div>
				{sheet}
			</TooltipProvider>
		</PageFrame>
	);
}

interface TargetSheetProps<Target> {
	/** What a link named, whose details the sheet shows; `null` closes it. */
	target: Target | null;
	onClose: () => void;
	children: (target: Target) => ReactNode;
}

/** The sheet with `target`'s details. It keeps the last target after `target` drops to `null`, so its content stays through the exit slide. */
export function TargetSheet<Target>({ target, onClose, children }: TargetSheetProps<Target>) {
	const kept = useRef<Target | null>(null);
	if (target !== null) kept.current = target;
	if (kept.current === null) return null;
	return (
		<Sheet open={target !== null} onClose={onClose}>
			{children(kept.current)}
		</Sheet>
	);
}
