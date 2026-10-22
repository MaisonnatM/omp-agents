import { type ReactNode, useEffect, useState } from "react";
import type { CleanupPolicy, CleanupReview, ComparisonSnapshot } from "../../src/shared/comparisons";
import type { RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { errorText } from "../api";
import { cleanupRemaining } from "../comparisons-model";
import { hashForComparisons, hashForNewVariants } from "../routing";
import { CleanupLosses, DiscardWorktreesDialog, KeepVariantDialog } from "./comparison-dialogs";
import { VariantCard } from "./comparison-variant-card";
import { useDashboardActions } from "./dashboard-context";
import { Header } from "./page-header";

function Comparison({ comparison, connected, hosts }: { comparison: ComparisonSnapshot; connected: boolean; hosts: RosterHost[] }) {
	const { request } = useDashboardActions();
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [discardReview, setDiscardReview] = useState<CleanupReview | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!connected) {
			setConfirmId(null);
			setDiscardReview(null);
		}
	}, [connected]);
	const available = connected && comparison.owner.kind === "local" && !pending;
	const run = async (action: () => Promise<void>): Promise<void> => {
		setPending(true);
		setError(null);
		try {
			await action();
		} catch (error) {
			setError(errorText(error));
		} finally {
			setPending(false);
		}
	};
	const keep = (): void => {
		if (!confirmId) return;
		const winner = confirmId;
		void run(async () => {
			await request({ t: "comparison-select", id: comparison.id, winner });
			setConfirmId(null);
			await request({ t: "comparison-review-cleanup", id: comparison.id });
		});
	};
	const review = comparison.cleanup.kind === "ready" ? comparison.cleanup.review : null;
	const cleanup = (policy: CleanupPolicy): void => {
		if (!review) return;
		void run(async () => {
			await request({ t: "comparison-cleanup", id: comparison.id, reviewId: review.id, policy });
			setDiscardReview(null);
		});
	};
	const winner = comparison.winner;
	const remaining = winner === null ? null : cleanupRemaining(comparison);
	const confirmIndex = comparison.variants.findIndex(variant => variant.id === confirmId);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Header title="Design comparison" meta={`${comparison.variants.length} variants`}>
				<a href={hashForComparisons()} className="text-xs underline underline-offset-4">All comparisons</a>
			</Header>
			<div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-3 sm:p-6">
				<div className="space-y-2 text-xs">
					<p className="whitespace-pre-wrap break-words text-sm">{comparison.prompt}</p>
					<p className="break-all text-muted-foreground">{comparison.sourceCwd}</p>
					<p className="break-all font-mono">Shared base {comparison.base} · {comparison.baseSha || "Not captured"}</p>
				</div>
				{!connected && <p role="status" className="text-sm text-muted-foreground">Offline. Showing the last received comparison. Actions wait for reconnection.</p>}
				{comparison.owner.kind === "other" && (
					<p role="status" className="text-sm">
						Another dashboard on port {comparison.owner.port} owns this comparison. These are saved results, not live updates.{" "}
						<a className="underline" href={`${location.protocol}//${location.hostname}:${comparison.owner.port}/${hashForComparisons(comparison.id)}`}>Open owning dashboard</a>
					</p>
				)}
				{comparison.owner.kind === "unavailable" && <p role="alert" className="text-sm">Comparison unavailable. {comparison.owner.reason}</p>}
				{error && <p role="alert" className="break-words text-sm text-red-600 dark:text-red-400">{error}</p>}
				<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] gap-4">
					{comparison.variants.map((variant, index) => (
						<VariantCard
							key={variant.id}
							variant={variant}
							number={index + 1}
							host={hosts.find(host => host.instanceId === variant.instanceId)}
							winner={winner === variant.id}
							canSelect={available && winner === null && variant.sessionId !== null && variant.lifecycle.kind !== "removed"}
							onSelect={() => setConfirmId(variant.id)}
						/>
					))}
				</div>
				{winner !== null && (
					<section className="space-y-4 rounded-xl border border-border p-4" aria-label="Losing worktrees">
						<h3 className="text-sm font-semibold">Losing worktrees</h3>
						<p className="text-xs">
							The kept session and every branch stay.{" "}
							{remaining === 0 ? "All losing checkouts were removed." : `${remaining} losing checkout${remaining === 1 ? " remains" : "s remain"}. Preserved or blocked checkouts are not removed.`}
						</p>
						{comparison.cleanup.kind === "stopping" && (
							<>
								<p role="status" className="text-xs">Waiting for sibling sessions to stop. No checkout will be removed before stops are verified.</p>
								<Button variant="secondary" size="compact" disabled={!available} onClick={() => void run(async () => {
									await request({ t: "comparison-select", id: comparison.id, winner });
									await request({ t: "comparison-review-cleanup", id: comparison.id });
								})}>Retry stopping siblings</Button>
							</>
						)}
						{review && (
							<>
								<p className="text-xs text-muted-foreground">This review lists the checkout data that discard would delete. Changes after this review require a fresh review.</p>
								<CleanupLosses review={review} />
								<div className="flex flex-wrap gap-3">
									<Button variant="secondary" size="compact" disabled={!available || remaining === 0} onClick={() => cleanup("preserve-changes")}>Keep worktrees</Button>
									<Button
										variant="secondary"
										className="h-auto min-h-7 whitespace-normal text-red-600 dark:text-red-400"
										size="compact"
										disabled={!available || remaining === 0}
										onClick={() => setDiscardReview(review)}
									>Discard worktrees…</Button>
								</div>
							</>
						)}
						<Button variant="ghost" size="compact" disabled={!available || remaining === 0} onClick={() => void run(() => request({ t: "comparison-review-cleanup", id: comparison.id }))}>
							Refresh loss review
						</Button>
					</section>
				)}
			</div>
			{confirmIndex >= 0 && (
				<KeepVariantDialog number={confirmIndex + 1} pending={pending} available={available} error={error} onClose={() => setConfirmId(null)} onConfirm={keep} />
			)}
			{discardReview && (
				<DiscardWorktreesDialog
					review={discardReview}
					currentReviewId={review?.id ?? null}
					pending={pending}
					available={available}
					error={error}
					onClose={() => setDiscardReview(null)}
					onConfirm={() => cleanup("discard-owned-changes")}
				/>
			)}
		</div>
	);
}

export function ComparisonsPage({ id, comparisons, connected, hosts }: { id: string | null; comparisons: ComparisonSnapshot[] | null; connected: boolean; hosts: RosterHost[] }) {
	const comparison = id === null ? null : comparisons?.find(comparison => comparison.id === id);
	if (comparison) return <Comparison key={comparison.id} comparison={comparison} connected={connected} hosts={hosts} />;
	let content: ReactNode;
	if (comparisons === null) {
		content = <p role="status" className="text-sm">{connected ? "Loading comparisons…" : "Connect to the dashboard to load comparisons."}</p>;
	} else if (id !== null) {
		content = (
			<p role="alert" className="text-sm">
				{connected ? "This comparison was not found." : "This comparison is not in the saved list. Reconnect to check."} Opening this link does not start sessions.{" "}
				<a className="underline" href={hashForComparisons()}>All comparisons</a>
			</p>
		);
	} else if (comparisons.length === 0) {
		content = <p className="text-sm text-muted-foreground">No design comparisons yet. Choose New comparison to start designs from one prompt.</p>;
	} else {
		content = (
			<ul className="space-y-3">
				{comparisons.map(comparison => (
					<li key={comparison.id}>
						<a href={hashForComparisons(comparison.id)} className="block space-y-1 rounded-lg border border-border p-3">
							<span className="block line-clamp-2 text-sm">{comparison.prompt || "Unreadable comparison"}</span>
							<span className="block break-all text-xs text-muted-foreground">
								{comparison.sourceCwd} · {comparison.variants.length} variants · {new Date(comparison.createdAt).toLocaleString()}{comparison.winner !== null && " · Winner kept"}
							</span>
						</a>
					</li>
				))}
			</ul>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Header title="Design comparisons">
				<a href={hashForNewVariants(null)} className="text-xs underline underline-offset-4">New comparison</a>
			</Header>
			<div className="space-y-4 overflow-y-auto p-6">
				{content}
				{!connected && comparisons !== null && <p role="status" className="text-xs text-muted-foreground">Offline. Showing the last received list.</p>}
			</div>
		</div>
	);
}
