import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Where a form stands: being written, sent, or refused with the server's reason; `Done` adds what the form shows once sent. */
export type Submit<Done = never> = { kind: "writing" } | { kind: "creating" } | { kind: "failed"; error: string } | Done;

/** A form's error line. */
export const ERROR_TEXT = "text-xs text-red-600 dark:text-red-400";

/** Cmd+Enter, or Ctrl+Enter, which sends the form. */
export const isSubmitChord = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey);

interface FormDialogProps {
	/** The form is sending, so Esc and a click outside keep the dialog open. */
	busy: boolean;
	onClose: () => void;
	/** Where the dialog's top sits, and its width and height. */
	className: string;
	/** The form, which shows a {@link FormDialogHeader} first. */
	children: ReactNode;
}

/** A dialog over the page that holds one form to fill in and send, such as a new issue or a new event. */
export function FormDialog({ busy, onClose, className, children }: FormDialogProps) {
	const popup = useRef<HTMLDivElement>(null);
	return (
		<DialogPrimitive.Root
			open
			onOpenChange={(open, details) => {
				// The form's Radix pickers render outside the popup; Esc there closes only the picker.
				if (details.reason === "escape-key" && !popup.current?.contains(details.event.target as Node)) return;
				if (!open && !busy) onClose();
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Popup
					ref={popup}
					className={cn("fixed left-1/2 z-50 flex max-h-[calc(100vh-2rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-hidden", className)}
				>
					{children}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

interface FormDialogHeaderProps {
	title: string;
	/** The form is sending, so the close button is off. */
	busy: boolean;
	/** Shown before the title. */
	lead?: ReactNode;
	/** Shown before the close button. */
	actions?: ReactNode;
}

/** A {@link FormDialog}'s header: its title, and its actions and close button at its end. */
export function FormDialogHeader({ title, busy, lead, actions }: FormDialogHeaderProps) {
	return (
		<div className="flex items-center gap-1.5 px-4 pt-3.5 text-[13px]">
			{lead}
			<DialogPrimitive.Title className="font-normal text-foreground">{title}</DialogPrimitive.Title>
			<div className="ml-auto flex items-center gap-0.5">
				{actions}
				<Tooltip content="Close" shortcut={["Esc"]} side="bottom">
					<DialogPrimitive.Close render={<Button variant="ghost" size="icon-compact" aria-label="Close" disabled={busy} />}>
						<X />
					</DialogPrimitive.Close>
				</Tooltip>
			</div>
		</div>
	);
}
