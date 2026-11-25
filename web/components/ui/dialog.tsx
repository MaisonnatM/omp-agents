import { Dialog as DialogPrimitive, DialogBackdrop as DialogBackdropPrimitive } from "@ui-sdk/react/dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** UI SDK's dialog, portaled into `document.body` so it sits above the page's own stacking contexts. */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive>) {
	return <DialogPrimitive container={typeof document === "undefined" ? undefined : document.body} {...props} />;
}

/** The dimmed layer behind a dialog; pass `className` to change its tint or add motion. */
function DialogBackdrop({ className, ...props }: React.ComponentProps<typeof DialogBackdropPrimitive>) {
	return <DialogBackdropPrimitive className={cn("fixed inset-0 z-40 bg-black/40 dark:bg-black/80", className)} {...props} />;
}

export { DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog";
export { Dialog, DialogBackdrop };
