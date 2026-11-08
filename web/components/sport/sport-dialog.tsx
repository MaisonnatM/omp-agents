/** The Sport page's dialog shell: a {@link FormDialog} whose copy, close button included, reads as French. */
import type { KeyboardEvent, ReactNode } from "react";
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
}

export function SportDialog({ title, busy = false, onClose, className, children, onKeyDown }: SportDialogProps) {
	return (
		<FormDialog busy={busy} onClose={onClose} className={className} onKeyDown={onKeyDown}>
			{/* The dialog renders in a portal, outside the page's `lang`. */}
			<div lang="fr" className="flex flex-col">
				<FormDialogHeader title={title} busy={busy} closeLabel="Fermer" />
				{children}
			</div>
		</FormDialog>
	);
}
