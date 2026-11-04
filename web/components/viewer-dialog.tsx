import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type LucideIcon, X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { type Zoom, ZoomControls, zoomKey, ZoomPane } from "./zoom-pane";

interface ViewerDialogProps {
	title: string;
	description: ReactNode;
	icon?: LucideIcon;
	/** Shown before the close button. */
	actions?: ReactNode;
	/** What screen readers call the scrolling body. */
	bodyLabel: string;
	/** Given, the body zooms as a browser zooms a page, with the zoom buttons before `actions` and +, −, and 0 on the keyboard. */
	zoom?: Zoom;
	onClose: () => void;
	children: ReactNode;
}

/** A large dialog over the page that shows one thing to read: a header with its title and actions, and a body that scrolls, or zooms. */
export function ViewerDialog({ title, description, icon: Icon, actions, bodyLabel, zoom, onClose, children }: ViewerDialogProps) {
	const body = useRef<HTMLDivElement>(null);
	const frame = "rounded-md border border-border";
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					// The body takes focus, so the arrow keys scroll it and no header tooltip opens.
					onOpenAutoFocus={event => {
						event.preventDefault();
						body.current?.focus();
					}}
					className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100vh-4rem)] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden"
					onKeyDown={zoom && (event => zoomKey(zoom, event))}
				>
					<div className="flex items-start gap-4">
						{Icon && <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
						<div className="min-w-0 flex-1 space-y-0.5">
							<DialogPrimitive.Title className="truncate text-sm font-semibold">{title}</DialogPrimitive.Title>
							<DialogPrimitive.Description className="truncate text-xs text-muted-foreground">{description}</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{zoom && <ZoomControls zoom={zoom} />}
							{actions}
							<Tooltip content="Close" shortcut={["Esc"]}>
								<DialogPrimitive.Close asChild>
									<Button variant="ghost" size="icon-compact" aria-label="Close">
										<X />
									</Button>
								</DialogPrimitive.Close>
							</Tooltip>
						</div>
					</div>
					{zoom ? (
						<ZoomPane zoom={zoom} label={bodyLabel} paneRef={body} className={frame}>
							{children}
						</ZoomPane>
					) : (
						<div ref={body} role="region" tabIndex={0} aria-label={bodyLabel} className={`min-h-0 flex-1 overflow-auto outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${frame}`}>
							{children}
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
