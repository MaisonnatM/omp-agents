import { GitMerge, Layers } from "lucide-react";
import type { ReactElement } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { mergesNow, type PullRequest, type PullRequestDetail, pullRequestName, type StackedPullRequest } from "../../../src/shared/github";
import type { QueuedMerge } from "../../../src/shared/merge-queue";
import { MERGE_METHOD_LABELS, type MergeMethod } from "../../../src/shared/source-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { useRead } from "../../reads";
import type { Action } from "../../use-action";
import { useMergeController } from "./use-merge-controller";

/** What a merge of `pr` needs, read from GitHub only while its confirmation is `open`, for a place that holds no details of it. */
export const useMergeTarget = (pr: PullRequest, open: boolean) =>
	useRead<PullRequestDetail>(open ? `/api/pull-request?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}` : null);

/** What a merge needs from GitHub: where it lands, the head it is pinned to, the methods allowed, and whether it can merge now. */
export type MergeTarget = Pick<PullRequestDetail, "base" | "headOid" | "mergeMethods" | "mergeState" | "checks">;

/** Why `target` cannot merge now, said after its name. */
function waitReason({ mergeState, checks, base }: MergeTarget): string {
	if (mergeState === "behind") return `is behind ${base}, so its branch is updated first`;
	if (checks === "pending") return "has checks still running";
	if (mergeState === "blocked") return "waits on a review or a rule of its base branch";
	return "is still being checked by GitHub";
}

/** Where a queued merge stands, in a line: the pull request under way and what it waits on, or why it stopped. */
export function queuedMergeText(merge: QueuedMerge): string {
	const [pr] = merge.prs;
	const total = merge.merged + merge.prs.length;
	const place = total > 1 ? ` (${merge.merged} of ${total} merged)` : "";
	switch (merge.state.kind) {
		case "waiting":
			return `Merging #${pr?.number ?? "?"} when ready${place}: ${merge.state.why}.`;
		case "failed":
			return `Stopped at #${pr?.number ?? "?"}${place}: ${merge.state.why}`;
		default: {
			const unhandled: never = merge.state;
			return unhandled;
		}
	}
}

/** A queued merge's line and its **Cancel**, or **Dismiss** once it stopped. */
export function QueuedMergeNote({ merge, cancel }: { merge: QueuedMerge; cancel: Action<[]> }) {
	return (
		<div className="flex items-start gap-2 text-[13px]">
			<p role={merge.state.kind === "failed" ? "alert" : "status"} className={merge.state.kind === "failed" ? "flex-1 text-red-600 dark:text-red-400" : "flex-1 text-muted-foreground"}>
				{queuedMergeText(merge)}
			</p>
			<Button variant="ghost" size="compact" loading={cancel.pending} onClick={() => cancel.run()}>
				{merge.state.kind === "failed" ? "Dismiss" : "Cancel"}
			</Button>
		</div>
	);
}

/** What the trigger shows: the method the merge starts with, the queued merge that takes it, and whether the server is taking one now. */
export interface MergeTrigger {
	method: MergeMethod | null;
	queued: QueuedMerge | undefined;
	pending: boolean;
}

export interface MergePopoverProps {
	/** The pull request to merge: the bottom one of `stack`, when it merges a stack. */
	pr: PullRequest;
	/** The stack to merge, top first as its rail lists it; absent to merge `pr` alone. */
	stack?: StackedPullRequest[];
	/** What the merge needs from GitHub; `null` while it is read. */
	target: MergeTarget | null;
	/** Why `target` could not be read, if it could not. */
	error?: string | null;
	/** The server took the merge, whether it merged at once or waits. */
	onQueued?: () => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The trigger's tooltip, if any. */
	tooltip?: string;
	/** Which edge of the trigger the confirmation lines up with. */
	align?: "start" | "end";
	children: (trigger: MergeTrigger) => ReactElement;
}

/**
 * Merges on GitHub with the method Settings starts it on, after a confirmation that can switch the method, through the
 * server's merge queue, which merges once GitHub allows it, pinned to the head the confirmation showed; while queued, the
 * confirmation says where it stands and cancels it.
 */
export function MergePopover({ pr, stack, target, error = null, onQueued, open, onOpenChange, tooltip, align = "end", children }: MergePopoverProps) {
	const { allowed, method, pick, queued, merging, merge, cancel } = useMergeController({ pr, stack, target, onQueued });
	// Only the wording follows whether GitHub merges it now; the queue decides what the merge does.
	const later = stack !== undefined || (target !== null && !mergesNow(target));
	const confirm = (): void => {
		onOpenChange(false);
		merge();
	};
	const trigger = <PopoverTrigger asChild>{children({ method, queued, pending: merging })}</PopoverTrigger>;
	const question = (): ReactElement => {
		if (target === null)
			return (
				<p role={error ? "alert" : undefined} className="text-[13px] text-muted-foreground">
					{error ?? "Reading the pull request…"}
				</p>
			);
		if (stack)
			return (
				<p className="text-[13px] text-pretty">
					Merge the {stack.length} pull requests of this stack into <span className="font-mono">{target.base}</span>, bottom first? Each waits for the one below it, then is retargeted and updated as GitHub requires; the first failure stops the rest.
				</p>
			);
		if (later)
			return (
				<p className="text-[13px] text-pretty">
					{pullRequestName(pr)} {waitReason(target)}. Merge it into <span className="font-mono">{target.base}</span> once it is ready? The dashboard waits for it, even with this page closed.
				</p>
			);
		return (
			<p className="text-[13px] text-pretty">
				Merge {pullRequestName(pr)} into <span className="font-mono">{target.base}</span> on GitHub?
			</p>
		);
	};
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{tooltip ? (
				<Tooltip content={queued ? queuedMergeText(queued) : tooltip} forceOpen={open ? false : undefined}>
					{trigger}
				</Tooltip>
			) : (
				trigger
			)}
			<PopoverContent align={align} className="w-72 space-y-3 p-3">
				{queued ? (
					<QueuedMergeNote merge={queued} cancel={cancel} />
				) : (
					<>
						{question()}
						{target && allowed.length === 0 && <p className="text-[13px] text-muted-foreground">The repository allows no merge method.</p>}
						{allowed.length > 1 && method && (
							<RadioGroup aria-label="Merge method" value={method} onValueChange={value => { const candidate = allowed.find(each => each === value); if (candidate) pick(candidate); }} className="space-y-1">
								{allowed.map(candidate => (
									<label key={candidate} className="flex cursor-pointer items-center gap-2 text-[13px]">
										<Radio.Root value={candidate} className="flex size-3.5 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary">
											<Radio.Indicator className="size-1.5 rounded-full bg-background" />
										</Radio.Root>
										{MERGE_METHOD_LABELS[candidate]}
									</label>
								))}
							</RadioGroup>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" size="compact" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button variant="primary" size="compact" leadingIcon={stack ? Layers : GitMerge} disabled={method === null} loading={merging} onClick={confirm}>
								{method ? MERGE_METHOD_LABELS[method] : "Merge"}
								{later && " when ready"}
							</Button>
						</div>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
