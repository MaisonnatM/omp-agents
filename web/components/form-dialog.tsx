/** `FormDialog`, the dialog shell the dashboard's forms share, with its header, error line, and Cmd+Enter submit chord. */
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconCrossMedium } from "central-icons";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Where a form stands: being written, sent, or refused with the server's reason; `Done` adds what the form shows once sent. */
export type Submit<Done = never> = { kind: "writing" } | { kind: "creating" } | { kind: "failed"; error: string } | Done;

/** A form's error line. */
export const ERROR_TEXT = "text-xs text-red-600 dark:text-red-400";

/** Ways to dismiss a dialog besides its close button: Esc, or a click outside it. */
export type Dismissal = "escape-key" | "outside-press";

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
	/** Keys pressed anywhere in the dialog. */
	onKeyDown?: (event: KeyboardEvent) => void;
	/** What takes the focus as the dialog opens, in place of its first button. */
	initialFocus?: RefObject<HTMLElement | null>;
	/** Called on Esc or a click outside before the dialog closes; returns whether it closes. The close button always closes. */
	onDismiss?: (how: Dismissal) => boolean;
}

/** A dialog over the page that holds one form to fill in and send, such as a new issue or a new event. */
export function FormDialog({ busy, onClose, className, children, onKeyDown, initialFocus, onDismiss }: FormDialogProps) {
	return (
		<Dialog
			open
			dismissible={!busy}
			onOpenChange={(open, details) => {
				if (open) return;
				if ((details.reason === "escape-key" || details.reason === "outside-press") && onDismiss && !onDismiss(details.reason)) {
					details.cancel();
					return;
				}
				onClose();
			}}
		>
			<DialogBackdrop />
			<DialogContent
				onKeyDown={onKeyDown}
				initialFocus={initialFocus && (() => initialFocus.current)}
				className={cn("fixed left-1/2 z-50 flex max-h-[calc(100vh-2rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-hidden", className)}
			>
				{children}
			</DialogContent>
		</Dialog>
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
	/** The close button's tooltip and accessible name, for a dialog in another language. */
	closeLabel?: string;
	/** The close button's own size or color, for a dialog drawn on its own fill. */
	closeClassName?: string;
}

/** A {@link FormDialog}'s header: its title, and its actions and close button at its end. */
export function FormDialogHeader({ title, busy, lead, actions, closeLabel = "Close", closeClassName }: FormDialogHeaderProps) {
	return (
		<div className="flex items-center gap-1.5 px-4 pt-3.5 text-[13px]">
			{lead}
			<DialogTitle className="font-normal text-foreground">{title}</DialogTitle>
			<div className="ml-auto flex items-center gap-0.5">
				{actions}
				<Tooltip content={closeLabel} shortcut={["Esc"]} side="bottom">
					<DialogClose disabled={busy} render={<Button variant="ghost" size="icon-compact" className={closeClassName} aria-label={closeLabel} />}>
						<IconCrossMedium />
					</DialogClose>
				</Tooltip>
			</div>
		</div>
	);
}
