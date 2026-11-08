/** The Sport page's dialog shell: a {@link FormDialog} whose copy, close button included, reads as French. */
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { FormDialog, FormDialogHeader } from "../form-dialog";

interface SportDialogProps {
	title: string;
	/** While a write is in flight: the dialog stays open and its close button waits. */
	busy?: boolean;
	onClose: () => void;
	/** Where the dialog's top sits, and its width. */
	className: string;
	children: ReactNode;
	onKeyDown?: (event: KeyboardEvent) => void;
	/** Shown before the close button. */
	actions?: ReactNode;
	/** What takes the focus as the dialog opens, in place of its first button. */
	initialFocus?: RefObject<HTMLElement | null>;
	/** The close button's own size or color. */
	closeClassName?: string;
}

export function SportDialog({ title, busy = false, onClose, className, children, onKeyDown, actions, initialFocus, closeClassName }: SportDialogProps) {
	return (
		<FormDialog busy={busy} onClose={onClose} className={className} onKeyDown={onKeyDown} initialFocus={initialFocus}>
			{/* The dialog renders in a portal, outside the page's `lang`. It fills a popup given a height. */}
			<div lang="fr" className="flex flex-1 flex-col">
				<FormDialogHeader title={title} busy={busy} actions={actions} closeLabel="Fermer" closeClassName={closeClassName} />
				{children}
			</div>
		</FormDialog>
	);
}
