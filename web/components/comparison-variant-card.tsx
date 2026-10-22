import { useEffect, useReducer, useState } from "react";
import type { ComparisonVariant, VariantLifecycle, VariantScreenshot } from "../../src/shared/comparisons";
import { selectorOf } from "../../src/shared/models";
import { hashForSession, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { EMPTY_SCREENSHOT, screenshotPreview } from "../comparisons-model";
import { hashForView } from "../routing";
import { ImageViewer } from "./media-viewer";

function Screenshot({ screenshot, publicationError }: { screenshot: VariantScreenshot | null; publicationError: string | null }) {
	const [preview, dispatch] = useReducer(screenshotPreview, EMPTY_SCREENSHOT);
	const [viewing, setViewing] = useState(false);
	useEffect(() => {
		if (!screenshot) return;
		let active = true;
		dispatch({ kind: "publish", screenshot });
		const image = new Image();
		image.onload = () => {
			if (active) dispatch({ kind: "loaded", screenshot });
		};
		image.onerror = () => {
			if (active) dispatch({ kind: "failed", screenshot });
		};
		image.src = screenshot.src;
		return () => {
			active = false;
			image.onload = null;
			image.onerror = null;
		};
	}, [screenshot?.sequence, screenshot?.src]);
	const { shown, requested, failed } = preview;
	const latestFailed = failed && requested?.sequence === screenshot?.sequence;
	const updating = screenshot !== null && shown?.sequence !== screenshot.sequence && !latestFailed;
	let status = "The session must publish a screenshot to show it here.";
	if (latestFailed) status = shown ? "New screenshot failed to load. Showing the previous screenshot." : "Screenshot failed to load.";
	else if (updating) status = shown ? "Updating screenshot. Showing the previous screenshot." : "Loading screenshot…";
	else if (shown) status = `Publication ${shown.sequence} · ${new Date(shown.publishedAt).toLocaleString()}`;
	return (
		<div className="space-y-2">
			{shown ? (
				<button
					type="button"
					onClick={() => setViewing(true)}
					aria-label={`Enlarge screenshot. ${shown.caption}`}
					className="block w-full overflow-hidden rounded-md bg-muted outline -outline-offset-1 outline-black/10 focus-visible:ring-2 focus-visible:ring-ring dark:outline-white/10"
				>
					<img src={shown.src} alt={shown.caption} className="aspect-[4/3] w-full object-contain" />
				</button>
			) : (
				<div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted p-4 text-center text-xs text-muted-foreground">
					{latestFailed ? "Screenshot could not load." : screenshot ? "Loading screenshot…" : "No screenshot published yet."}
				</div>
			)}
			<div role="status" className="min-h-4 text-xs text-muted-foreground">{status}</div>
			{publicationError && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Screenshot publication failed. {publicationError}{shown && " Showing the previous screenshot."}
				</p>
			)}
			{viewing && shown && (
				<ImageViewer
					src={shown.src}
					caption={shown.caption}
					index={0}
					count={1}
					detail={`Publication ${shown.sequence}${updating ? " · Updating, previous screenshot" : latestFailed ? " · Update failed, previous screenshot" : ""}`}
					previousLabel="Previous screenshot"
					nextLabel="Next screenshot"
					onIndex={index => setViewing(index === 0)}
					onClose={() => setViewing(false)}
				/>
			)}
		</div>
	);
}

const LIFECYCLE_LABELS: Record<VariantLifecycle["kind"], string> = {
	queued: "Queued",
	starting: "Starting",
	registered: "Registered, waiting to send",
	"prompt-attempted": "Sending first prompt",
	running: "Running",
	failed: "Start failed",
	cancelled: "Cancelled",
	uncertain: "First prompt uncertain",
	stopping: "Stopping",
	"stop-blocked": "Stop blocked",
	stopped: "Stopped",
	preserved: "Stopped, checkout kept",
	removed: "Stopped, checkout removed",
	"cleanup-blocked": "Stopped, removal blocked",
};

function LifecycleDetail({ lifecycle }: { lifecycle: VariantLifecycle }) {
	switch (lifecycle.kind) {
		case "failed":
			return <p role="alert" className="text-xs text-red-600 dark:text-red-400">{lifecycle.error}</p>;
		case "uncertain":
			return <p className="text-xs text-amber-700 dark:text-amber-400">{lifecycle.reason} The first prompt will not be sent again automatically.</p>;
		case "stop-blocked":
			return <p role="alert" className="text-xs text-red-600 dark:text-red-400">{lifecycle.reason}</p>;
		case "cleanup-blocked":
			return (
				<ul className="space-y-1 text-xs text-red-600 dark:text-red-400">
					{lifecycle.reasons.map(reason => <li key={reason}>{reason}</li>)}
				</ul>
			);
		default:
			return null;
	}
}

interface VariantCardProps {
	variant: ComparisonVariant;
	number: number;
	host: RosterHost | undefined;
	winner: boolean;
	canSelect: boolean;
	onSelect: () => void;
}

export function VariantCard({ variant, number, host, winner, canSelect, onSelect }: VariantCardProps) {
	const link = host
		? hashForView({ kind: "live", instanceId: host.instanceId, agentId: null })
		: variant.sessionId ? hashForSession(variant.sessionId) : null;
	const model = host?.model ?? (variant.model ? selectorOf(variant.model) : "Not reported");
	const thinking = host ? host.thinkingLevel : variant.thinkingLevel;
	return (
		<article className="min-w-0 space-y-3 rounded-xl border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">Variant {number}{winner && " · Kept"}</h3>
				<span className="text-xs text-muted-foreground">
					{LIFECYCLE_LABELS[variant.lifecycle.kind]}
					{variant.lifecycle.kind === "running" && host && ` · ${host.status}`}
				</span>
			</div>
			<Screenshot screenshot={variant.screenshot} publicationError={variant.screenshotError} />
			<dl className="space-y-1 break-words text-xs">
				<div>
					<dt className="inline text-muted-foreground">Requested model </dt>
					<dd className="inline">
						{variant.selection.model ? selectorOf(variant.selection.model) : "Configured default"}
						{variant.selection.thinking && ` · ${variant.selection.thinking}`}
					</dd>
				</div>
				<div>
					<dt className="inline text-muted-foreground">Actual model </dt>
					<dd className="inline">{model}{thinking && ` · ${thinking}`}</dd>
				</div>
				<div>
					<dt className="inline text-muted-foreground">Branch </dt>
					<dd className="inline font-mono">{variant.branch}</dd>
				</div>
			</dl>
			<LifecycleDetail lifecycle={variant.lifecycle} />
			<div className="flex flex-wrap items-center gap-3">
				{link && (
					<a href={link} aria-label={`Open session for variant ${number}`} className="py-2 text-xs underline underline-offset-4">Open session</a>
				)}
				<Button
					size="compact"
					variant="secondary"
					aria-label={winner ? `Kept variant ${number}` : `Keep this one, variant ${number}`}
					disabled={!canSelect}
					onClick={onSelect}
				>
					{winner ? "Kept" : "Keep this one"}
				</Button>
			</div>
		</article>
	);
}
