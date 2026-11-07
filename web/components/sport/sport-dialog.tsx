/** The Sport page's dialog shell: a {@link FormDialog} whose copy, close button included, reads as French. */
import type { ReactNode } from "react";
import { FormDialog, FormDialogHeader } from "../form-dialog";

interface SportDialogProps {
	title: string;
	onClose: () => void;
	/** Where the dialog's top sits, and its width. */
	className: string;
	children: ReactNode;
}

export function SportDialog({ title, onClose, className, children }: SportDialogProps) {
	return (
		<FormDialog busy={false} onClose={onClose} className={className}>
			{/* The dialog renders in a portal, outside the page's `lang`. */}
			<div lang="fr" className="flex flex-col">
				<FormDialogHeader title={title} busy={false} closeLabel="Fermer" />
				{children}
			</div>
		</FormDialog>
	);
}
