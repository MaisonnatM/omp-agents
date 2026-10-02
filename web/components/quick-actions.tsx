import { CircleX, Eye, GitMerge, Hammer, ListChecks, type LucideIcon, MessageSquare, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { modeOf, SPLIT_CLICK } from "../labels";
import { QUICK_ACTIONS, type QuickActionId } from "../quick-actions";
import type { OpenMode } from "../routing";
import type { QuickOp } from "../starts";

const ICON: Record<QuickActionId, LucideIcon> = {
	"fix-ci": CircleX,
	"resolve-conflicts": GitMerge,
	"address-comments": MessageSquare,
	review: Eye,
	work: Hammer,
	plan: ListChecks,
};

interface QuickActionsProps<Id extends QuickActionId> {
	/** The actions that apply to the row's pull request or issue, in the order offered. */
	actions: Id[];
	/** The action whose session is starting for it, if any. */
	pending: Id | null;
	onRun: (action: Id, mode: OpenMode) => void;
}

/** A row's menu of `actions`, named by `label`; nothing when there is none. */
export function QuickActionsMenu<Id extends QuickActionId>({ actions, pending, onRun, label }: QuickActionsProps<Id> & { label: string }) {
	if (actions.length === 0) return null;
	return (
		<DropdownMenu>
			<Tooltip content={label}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={label} loading={pending !== null} />}>
					<Zap />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				{actions.map(id => {
					const Icon: LucideIcon = ICON[id];
					return (
						<MenuItem key={id} title={QUICK_ACTIONS[id].description} onClick={event => onRun(id, modeOf(event))}>
							<Icon />
							{QUICK_ACTIONS[id].label}
						</MenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A sheet's buttons for `actions`; nothing when there is none. One start at a time: all wait while one is pending. */
export function QuickActionButtons<Id extends QuickActionId>({ actions, pending, onRun }: QuickActionsProps<Id>) {
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{actions.map(id => (
				<Tooltip key={id} content={`${QUICK_ACTIONS[id].description} (${SPLIT_CLICK} to split)`}>
					<Button
						variant="secondary"
						size="compact"
						leadingIcon={ICON[id]}
						loading={pending === id}
						disabled={pending !== null}
						onClick={event => onRun(id, modeOf(event))}
					>
						{QUICK_ACTIONS[id].label}
					</Button>
				</Tooltip>
			))}
		</div>
	);
}

/** Why a quick action's session did not start, with a button that forgets it. */
export function QuickStartFailed({ op: { subject }, error, onDismiss }: { op: QuickOp; error: string; onDismiss: () => void }) {
	const name = subject.kind === "ticket" ? subject.id : `${subject.pr.owner}/${subject.pr.repo}#${subject.pr.number}`;
	return (
		<p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
			<span className="min-w-0">
				Cannot start "{QUICK_ACTIONS[subject.action].label}" on {name}: {error}
			</span>
			<Button variant="ghost" size="compact" className="shrink-0" onClick={onDismiss}>
				Dismiss
			</Button>
		</p>
	);
}
