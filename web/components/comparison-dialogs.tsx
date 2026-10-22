import type { CleanupReview } from "../../src/shared/comparisons";
import { Button } from "@/components/ui/button";
import { FormDialog, FormDialogHeader } from "./form-dialog";

export function CleanupLosses({ review }: { review: CleanupReview }) {
	return (
		<ul className="space-y-4">
			{review.rows.map(row => (
				<li key={row.variantId} className="space-y-2 rounded-md border border-border p-3 text-xs">
					<p className="break-all font-mono">{row.path}</p>
					<p className="break-all text-muted-foreground">Branch {row.branch} stays.</p>
					{row.removed ? <p>Checkout already removed.</p> : (
						<>
							{([
								["Tracked changes", row.tracked],
								["Untracked files", row.untracked],
								["Ignored files", row.ignored],
							] as const).map(([label, paths]) => (
								<div key={label}>
									<h4 className="font-medium">{label} · {paths.length}</h4>
									{paths.length > 0 ? (
										<ul className="mt-1 space-y-1 break-all font-mono">
											{paths.map(path => <li key={path}>{path}</li>)}
										</ul>
									) : <p className="text-muted-foreground">None</p>}
								</div>
							))}
							{row.blockers.length > 0 && (
								<div>
									<h4 className="font-medium">Removal blockers</h4>
									<ul className="mt-1 space-y-1">
										{row.blockers.map((blocker, index) => (
											<li key={`${blocker.code}-${index}`}>
												{blocker.message}
												{blocker.code === "changed" && " Explicit discard can remove these owned changes. Other blockers remain."}
											</li>
										))}
									</ul>
								</div>
							)}
						</>
					)}
				</li>
			))}
		</ul>
	);
}

interface ConfirmationProps {
	pending: boolean;
	available: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}

export function KeepVariantDialog({ number, pending, available, error, onClose, onConfirm }: ConfirmationProps & { number: number }) {
	return (
		<FormDialog busy={pending} onClose={onClose} className="top-[15vh] w-[min(32rem,calc(100vw-2rem))]">
			<FormDialogHeader title={`Keep variant ${number}?`} busy={pending} />
			<div className="space-y-4 p-4">
				<p className="text-sm">
					This stops every sibling session, including its background processes. It does not delete worktrees.
					After stopping, review the exact files before deciding whether to discard them.
				</p>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
				<div className="flex flex-wrap justify-end gap-3">
					<Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
					<Button disabled={!available} onClick={onConfirm}>{pending ? "Stopping siblings…" : "Keep and stop siblings"}</Button>
				</div>
			</div>
		</FormDialog>
	);
}

export function DiscardWorktreesDialog({ review, currentReviewId, pending, available, error, onClose, onConfirm }: ConfirmationProps & { review: CleanupReview; currentReviewId: string | null }) {
	const stale = review.id !== currentReviewId;
	return (
		<FormDialog busy={pending} onClose={onClose} className="top-[5vh] w-[min(38rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Discard losing worktrees?" busy={pending} />
			<div className="space-y-4 p-4">
				<p className="text-sm">
					Permanently delete these owned losing checkouts and their tracked, untracked, and ignored changes.
					The kept checkout and every branch stay. Other safety blockers still prevent removal.
				</p>
				<CleanupLosses review={review} />
				{stale && <p role="alert" className="text-sm">The loss review changed. Close this dialog and review the current files before discarding.</p>}
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
				<div className="flex flex-wrap justify-end gap-3">
					<Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
					<Button className="h-auto min-h-9 whitespace-normal" disabled={!available || stale} onClick={onConfirm}>
						{pending ? "Removing worktrees…" : "Discard owned changes and remove"}
					</Button>
				</div>
			</div>
		</FormDialog>
	);
}
