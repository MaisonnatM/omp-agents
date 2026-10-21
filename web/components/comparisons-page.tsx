import { type ReactNode, useEffect, useReducer, useState } from "react";
import type { CleanupPolicy, CleanupReview, ComparisonSnapshot, ComparisonVariant, VariantScreenshot } from "../../src/shared/comparisons";
import { selectorOf } from "../../src/shared/models";
import { hashForSession, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { errorText } from "../api";
import { cleanupRemaining, EMPTY_SCREENSHOT, screenshotPreview } from "../comparisons-model";
import { hashForComparisons, hashForNewSession, hashForView } from "../routing";
import { useDashboardActions } from "./dashboard-context";
import { FormDialog, FormDialogHeader } from "./form-dialog";
import { ImageViewer } from "./media-viewer";
import { Header } from "./page-header";

function Screenshot({ screenshot, publicationError }: { screenshot: VariantScreenshot | null; publicationError: string | null }) {
	const [preview, dispatch] = useReducer(screenshotPreview, EMPTY_SCREENSHOT);
	const [viewing, setViewing] = useState(false);
	useEffect(() => {
		if (!screenshot) return;
		let active = true;
		dispatch({ kind: "publish", screenshot });
		const image = new Image();
		image.onload = () => { if (active) dispatch({ kind: "loaded", screenshot }); };
		image.onerror = () => { if (active) dispatch({ kind: "failed", screenshot }); };
		image.src = screenshot.src;
		return () => { active = false; image.onload = null; image.onerror = null; };
	}, [screenshot?.sequence, screenshot?.src]);
	const { shown, requested, failed } = preview;
	const latestFailed = failed && requested?.sequence === screenshot?.sequence;
	const updating = screenshot !== null && shown?.sequence !== screenshot.sequence && !latestFailed;
	return (
		<div className="space-y-2">
			{shown ? (
				<button type="button" onClick={() => setViewing(true)} aria-label={`Enlarge screenshot. ${shown.caption}`} className="block w-full overflow-hidden rounded-md bg-muted outline -outline-offset-1 outline-black/10 focus-visible:ring-2 focus-visible:ring-ring dark:outline-white/10">
					<img src={shown.src} alt={shown.caption} className="aspect-[4/3] w-full object-contain" />
				</button>
			) : <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted p-4 text-center text-xs text-muted-foreground">{latestFailed ? "Screenshot could not load." : screenshot ? "Loading screenshot…" : "No screenshot published yet."}</div>}
			<div role="status" className="min-h-4 text-xs text-muted-foreground">
				{latestFailed ? shown ? "New screenshot failed to load. Showing the previous screenshot." : "Screenshot failed to load." : updating ? shown ? "Updating screenshot. Showing the previous screenshot." : "Loading screenshot…" : shown ? `Publication ${shown.sequence} · ${new Date(shown.publishedAt).toLocaleString()}` : "The session must publish a screenshot to show it here."}
			</div>
			{publicationError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Screenshot publication failed. {publicationError}{shown && " Showing the previous screenshot."}</p>}
			{viewing && shown && (
				<ImageViewer
					src={shown.src} caption={shown.caption} index={0} count={1}
					detail={`Publication ${shown.sequence}${updating ? " · Updating, previous screenshot" : latestFailed ? " · Update failed, previous screenshot" : ""}`}
					previousLabel="Previous screenshot" nextLabel="Next screenshot"
					onIndex={index => setViewing(index === 0)} onClose={() => setViewing(false)}
				/>
			)}
		</div>
	);
}

const START_LABELS: Record<ComparisonVariant["start"]["kind"], string> = { queued: "Queued", starting: "Starting", registered: "Started", failed: "Failed", cancelled: "Cancelled" };
const PROMPT_LABELS: Record<ComparisonVariant["firstPrompt"]["kind"], string> = { "not-attempted": "Not sent", attempted: "Sending", admitted: "Sent", uncertain: "Uncertain" };
const STOP_LABELS: Record<ComparisonVariant["stop"]["kind"], string> = { "not-requested": "Running", stopping: "Stopping", stopped: "Stopped", blocked: "Stop blocked" };
const CHECKOUT_LABELS: Record<ComparisonVariant["cleanup"]["kind"], string> = { pending: "Present", preserved: "Kept", removed: "Removed", blocked: "Removal blocked" };

function VariantCard({ variant, host, winner, canSelect, onSelect }: {
	variant: ComparisonVariant; host: RosterHost | undefined; winner: boolean; canSelect: boolean; onSelect: () => void;
}) {
	const link = host ? hashForView({ kind: "live", instanceId: host.instanceId, agentId: null }) : variant.sessionId ? hashForSession(variant.sessionId) : null;
	return (
		<article className="min-w-0 space-y-3 rounded-xl border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Variant {variant.ordinal}{winner && " · Kept"}</h3><span className="text-xs text-muted-foreground">{host?.status ?? (variant.stop.kind === "stopped" ? "Stopped" : variant.start.kind === "registered" ? "Not in live roster" : START_LABELS[variant.start.kind])}</span></div>
			<Screenshot screenshot={variant.screenshot} publicationError={variant.screenshotError} />
			<dl className="space-y-1 break-words text-xs">
				<div><dt className="inline text-muted-foreground">Requested model </dt><dd className="inline">{variant.model ? selectorOf(variant.model) : "Configured default"}{variant.thinking && ` · ${variant.thinking}`}</dd></div>
				<div><dt className="inline text-muted-foreground">Actual model </dt><dd className="inline">{host?.model ?? "Not reported"}{host?.thinkingLevel && ` · ${host.thinkingLevel}`}</dd></div>
				<div><dt className="inline text-muted-foreground">Branch </dt><dd className="inline font-mono">{variant.branch}</dd></div>
				<div><dt className="inline text-muted-foreground">Start </dt><dd className="inline">{START_LABELS[variant.start.kind]}</dd></div>
				<div><dt className="inline text-muted-foreground">First prompt </dt><dd className="inline">{PROMPT_LABELS[variant.firstPrompt.kind]}</dd></div>
				{variant.stop.kind !== "not-requested" && <div><dt className="inline text-muted-foreground">Stop </dt><dd className="inline">{STOP_LABELS[variant.stop.kind]}</dd></div>}
				<div><dt className="inline text-muted-foreground">Checkout </dt><dd className="inline">{CHECKOUT_LABELS[variant.cleanup.kind]}</dd></div>
			</dl>
			{variant.start.kind === "failed" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{variant.start.error}</p>}
			{variant.firstPrompt.kind === "uncertain" && <p className="text-xs text-amber-700 dark:text-amber-400">{variant.firstPrompt.reason} The first prompt will not be sent again automatically.</p>}
			{variant.stop.kind === "blocked" && <p className="text-xs text-red-600 dark:text-red-400">{variant.stop.reason}</p>}
			{variant.cleanup.kind === "blocked" && <ul className="space-y-1 text-xs text-red-600 dark:text-red-400">{variant.cleanup.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
			<div className="flex flex-wrap items-center gap-3">
				{link && <a href={link} aria-label={`Open session for variant ${variant.ordinal}`} className="py-2 text-xs underline underline-offset-4">Open session</a>}
				<Button size="compact" variant="secondary" aria-label={winner ? `Kept variant ${variant.ordinal}` : `Keep this one, variant ${variant.ordinal}`} disabled={!canSelect} onClick={onSelect}>{winner ? "Kept" : "Keep this one"}</Button>
			</div>
		</article>
	);
}

export function CleanupLosses({ review }: { review: CleanupReview }) {
	return <ul className="space-y-4">{review.rows.map(row => (
		<li key={row.variantId} className="space-y-2 rounded-md border border-border p-3 text-xs">
			<p className="break-all font-mono">{row.path}</p><p className="break-all text-muted-foreground">Branch {row.branch} stays.</p>
			{row.removed ? <p>Checkout already removed.</p> : <>
				{([['Tracked changes', row.tracked], ['Untracked files', row.untracked], ['Ignored files', row.ignored]] as const).map(([label, paths]) => <div key={label}><h4 className="font-medium">{label} · {paths.length}</h4>{paths.length > 0 ? <ul className="mt-1 space-y-1 break-all font-mono">{paths.map(path => <li key={path}>{path}</li>)}</ul> : <p className="text-muted-foreground">None</p>}</div>)}
				{row.blockers.length > 0 && <div><h4 className="font-medium">Removal blockers</h4><ul className="mt-1 space-y-1">{row.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}{blocker.code === "changed" && " Explicit discard can remove these owned changes. Other blockers remain."}</li>)}</ul></div>}
			</>}
		</li>
	))}</ul>;
}

function Comparison({ comparison, connected, hosts }: { comparison: ComparisonSnapshot; connected: boolean; hosts: RosterHost[] }) {
	const { request } = useDashboardActions();
	const [confirm, setConfirm] = useState<ComparisonVariant | null>(null);
	const [discardReview, setDiscardReview] = useState<CleanupReview | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!connected) {
			setConfirm(null);
			setDiscardReview(null);
		}
	}, [connected]);
	const available = connected && comparison.owner.kind === "local" && !pending;
	const run = async (action: () => Promise<void>): Promise<void> => {
		setPending(true); setError(null);
		try { await action(); } catch (error) { setError(errorText(error)); } finally { setPending(false); }
	};
	const keep = (): void => {
		if (!confirm) return;
		const winner = confirm.id;
		void run(async () => {
			await request({ t: "comparison-select", id: comparison.id, winner });
			setConfirm(null);
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
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Header title="Design comparison" meta={`${comparison.variants.length} variants`}><a href={hashForComparisons()} className="text-xs underline underline-offset-4">All comparisons</a></Header>
			<div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-3 sm:p-6">
				<div className="space-y-2 text-xs"><p className="whitespace-pre-wrap break-words text-sm">{comparison.prompt}</p><p className="break-all text-muted-foreground">{comparison.sourceCwd}</p><p className="break-all font-mono">Shared base {comparison.base} · {comparison.baseSha || "Not captured"}</p></div>
				{!connected && <p role="status" className="text-sm text-muted-foreground">Offline. Showing the last received comparison. Actions wait for reconnection.</p>}
				{comparison.owner.kind === "other" && (
					<p role="status" className="text-sm">
						Another dashboard on port {comparison.owner.port} owns this comparison. These are saved results, not live updates.{" "}
						<a className="underline" href={`${location.protocol}//${location.hostname}:${comparison.owner.port}/${hashForComparisons(comparison.id)}`}>Open owning dashboard</a>
					</p>
				)}
				{comparison.owner.kind === "unavailable" && <p role="alert" className="text-sm">Comparison unavailable. {comparison.owner.reason}</p>}
				{(error || comparison.error) && <p role="alert" className="break-words text-sm text-red-600 dark:text-red-400">{error || comparison.error}</p>}
				<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] gap-4">{comparison.variants.map(variant => <VariantCard key={variant.id} variant={variant} host={hosts.find(host => host.instanceId === variant.instanceId)} winner={comparison.winner === variant.id} canSelect={available && comparison.winner === null && variant.start.kind === "registered"} onSelect={() => setConfirm(variant)} />)}</div>
				{winner !== null && <section className="space-y-4 rounded-xl border border-border p-4" aria-label="Losing worktrees">
					<h3 className="text-sm font-semibold">Losing worktrees</h3>
					<p className="text-xs">The kept session and every branch stay. {remaining === 0 ? "All losing checkouts were removed." : `${remaining} losing checkout${remaining === 1 ? " remains" : "s remain"}. Preserved or blocked checkouts are not removed.`}</p>
					{comparison.cleanup.kind === "stopping" && <p role="status" className="text-xs">Waiting for sibling sessions to stop. No checkout will be removed before stops are verified.</p>}
					{comparison.cleanup.kind === "stopping" && (
						<Button variant="secondary" size="compact" disabled={!available} onClick={() => void run(async () => {
							await request({ t: "comparison-select", id: comparison.id, winner });
							await request({ t: "comparison-review-cleanup", id: comparison.id });
						})}>Retry stopping siblings</Button>
					)}
					{review && (
						<>
							<p className="text-xs text-muted-foreground">This review lists the checkout data that discard would delete. Changes after this review require a fresh review.</p>
							<CleanupLosses review={review} />
							<div className="flex flex-wrap gap-3">
								<Button variant="secondary" size="compact" disabled={!available || remaining === 0} onClick={() => cleanup("preserve-changes")}>Keep worktrees</Button>
								<Button variant="secondary" className="h-auto min-h-7 whitespace-normal text-red-600 dark:text-red-400" size="compact" disabled={!available || remaining === 0} onClick={() => setDiscardReview(review)}>Discard worktrees…</Button>
							</div>
						</>
					)}
					<Button variant="ghost" size="compact" disabled={!available || remaining === 0} onClick={() => void run(() => request({ t: "comparison-review-cleanup", id: comparison.id }))}>Refresh loss review</Button>
				</section>}
			</div>
			{confirm && (
				<FormDialog busy={pending} onClose={() => setConfirm(null)} className="top-[15vh] w-[min(32rem,calc(100vw-2rem))]">
					<FormDialogHeader title={`Keep variant ${confirm.ordinal}?`} busy={pending} />
					<div className="space-y-4 p-4">
						<p className="text-sm">This stops every sibling session, including its background processes. It does not delete worktrees. After stopping, review the exact files before deciding whether to discard them.</p>
						{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
						<div className="flex flex-wrap justify-end gap-3">
							<Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
							<Button disabled={!available} onClick={keep}>{pending ? "Stopping siblings…" : "Keep and stop siblings"}</Button>
						</div>
					</div>
				</FormDialog>
			)}
			{discardReview && (
				<FormDialog busy={pending} onClose={() => setDiscardReview(null)} className="top-[5vh] w-[min(38rem,calc(100vw-2rem))]">
					<FormDialogHeader title="Discard losing worktrees?" busy={pending} />
					<div className="space-y-4 p-4">
						<p className="text-sm">Permanently delete these owned losing checkouts and their tracked, untracked, and ignored changes. The kept checkout and every branch stay. Other safety blockers still prevent removal.</p>
						<CleanupLosses review={discardReview} />
						{discardReview.id !== review?.id && <p role="alert" className="text-sm">The loss review changed. Close this dialog and review the current files before discarding.</p>}
						{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
						<div className="flex flex-wrap justify-end gap-3">
							<Button variant="ghost" disabled={pending} onClick={() => setDiscardReview(null)}>Cancel</Button>
							<Button className="h-auto min-h-9 whitespace-normal" disabled={!available || discardReview.id !== review?.id} onClick={() => cleanup("discard-owned-changes")}>{pending ? "Removing worktrees…" : "Discard owned changes and remove"}</Button>
						</div>
					</div>
				</FormDialog>
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
		content = <p className="text-sm text-muted-foreground">No design comparisons yet. In New session, choose Variants to start designs from one prompt.</p>;
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
			<Header title="Design comparisons"><a href={hashForNewSession(null)} className="text-xs underline underline-offset-4">New session</a></Header>
			<div className="space-y-4 overflow-y-auto p-6">
				{content}
				{!connected && comparisons !== null && <p role="status" className="text-xs text-muted-foreground">Offline. Showing the last received list.</p>}
			</div>
		</div>
	);
}
