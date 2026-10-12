/** `ExplorerDialog`: the near full-size overlay that holds a changes explorer, with a title bar, actions, and close. */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** A changes explorer over the page, nearly full size: its title and actions on a bar above it, with the close button; Esc closes it. */
export function ExplorerDialog({ title, actions, children, onClose }: { title: ReactNode; actions?: ReactNode; children: ReactNode; onClose: () => void }) {
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100vh-4rem)] w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden"
				>
					<div className="flex items-center gap-4 border-b border-border py-2 pr-2 pl-4">
						<DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DialogPrimitive.Title>
						{actions}
						<Tooltip content="Close" shortcut={["Esc"]}>
							<DialogPrimitive.Close asChild>
								<Button variant="ghost" size="icon-compact" aria-label="Close">
									<X />
								</Button>
							</DialogPrimitive.Close>
						</Tooltip>
					</div>
					{children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
