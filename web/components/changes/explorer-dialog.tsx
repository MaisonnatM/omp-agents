import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { IconCrossMedium } from "central-icons";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** A changes explorer over the page, nearly full size: its title and actions on a bar above it, with the close button; Esc closes it. */
export function ExplorerDialog({ title, actions, children, onClose }: { title: ReactNode; actions?: ReactNode; children: ReactNode; onClose: () => void }) {
	return (
		<Dialog open container={document.body} onOpenChange={next => !next && onClose()}>
			<DialogBackdrop className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
			<DialogContent className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100vh-4rem)] w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden">
				<div className="flex items-center gap-4 border-b border-border py-2 pr-2 pl-4">
					<DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DialogTitle>
					{actions}
					<Tooltip content="Close" shortcut={["Esc"]}>
						<DialogClose render={<Button variant="ghost" size="icon-compact" aria-label="Close" />}>
							<IconCrossMedium />
						</DialogClose>
					</Tooltip>
				</div>
				{children}
			</DialogContent>
		</Dialog>
	);
}
