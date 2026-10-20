/** `ImageViewer`, one image of a list shown large, which the Media tab and the transcript's tool images open. */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface ImageViewerProps {
	src: string;
	/** What the image shows, as one line: the dialog's title and the image's alt text. */
	caption: string;
	/** The shown image's place in the list, from 0, and the list's length. */
	index: number;
	count: number;
	/** Said after `N of M`, such as when the image was taken. */
	detail?: string;
	/** Header buttons before open-in-new-tab and Close. */
	actions?: ReactNode;
	/** The labels of the buttons to the image before (← key) and after (→ key) it in the list. */
	previousLabel: string;
	nextLabel: string;
	/** Show the image at `index`, always within the list. */
	onIndex: (index: number) => void;
	onClose: () => void;
}

/** One image large, with its caption, its place in a list, and buttons and ←/→ to the images before and after it. */
export function ImageViewer({ src, caption, index, count, detail, actions, previousLabel, nextLabel, onIndex, onClose }: ImageViewerProps) {
	const step = (by: 1 | -1): void => {
		const next = index + by;
		if (next >= 0 && next < count) onIndex(next);
	};
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					// The dialog itself takes focus, so no header tooltip opens and one Esc closes it.
					onOpenAutoFocus={event => {
						event.preventDefault();
						(event.currentTarget as HTMLElement).focus();
					}}
					className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden"
					onKeyDown={event => {
						if (event.altKey || event.metaKey || event.ctrlKey) return;
						const by = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
						if (by === null) return;
						event.preventDefault();
						step(by);
					}}
				>
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-0.5">
							<Tooltip content={caption} side="bottom">
								<DialogPrimitive.Title className="truncate text-sm font-semibold">
									{caption}
								</DialogPrimitive.Title>
							</Tooltip>
							<DialogPrimitive.Description className="text-xs text-muted-foreground">
								{index + 1} of {count}
								{detail && ` · ${detail}`}
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{actions}
							<Tooltip content="Open the image in a new tab">
								<Button variant="ghost" size="icon-compact" aria-label="Open the image in a new tab" asChild>
									<a href={src} target="_blank" rel="noopener noreferrer">
										<ExternalLink />
									</a>
								</Button>
							</Tooltip>
							<Tooltip content="Close" shortcut={["Esc"]}>
								<DialogPrimitive.Close asChild>
									<Button variant="ghost" size="icon-compact" aria-label="Close">
										<X />
									</Button>
								</DialogPrimitive.Close>
							</Tooltip>
						</div>
					</div>
					<div className="flex min-h-0 flex-1 items-center gap-2">
						<Tooltip content={previousLabel} shortcut={["←"]} disabled={index === 0}>
							<Button variant="ghost" size="icon-compact" aria-label={previousLabel} disabled={index === 0} onClick={() => step(-1)}>
								<ChevronLeft />
							</Button>
						</Tooltip>
						<img src={src} alt={caption} className="min-h-0 min-w-0 flex-1 max-h-[calc(100vh-9rem)] object-contain" />
						<Tooltip content={nextLabel} shortcut={["→"]} disabled={index === count - 1}>
							<Button variant="ghost" size="icon-compact" aria-label={nextLabel} disabled={index === count - 1} onClick={() => step(1)}>
								<ChevronRight />
							</Button>
						</Tooltip>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
