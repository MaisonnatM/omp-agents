import { CircleX, Eye, GitMerge, Hammer, ListChecks, type LucideIcon, MessageSquare, Radiation, Zap } from "lucide-react";
import type { View } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modeOf, SPLIT_CLICK } from "../labels";
import { QUICK_ACTIONS, type QuickActionId } from "../quick-actions";
import type { OpenMode } from "../routing";
import type { StartOf } from "../starts";

const ICON: Record<QuickActionId, LucideIcon> = {
	"fix-ci": CircleX,
	"resolve-conflicts": GitMerge,
	"address-comments": MessageSquare,
	review: Eye,
	"thermonuclear-review": Radiation,
	work: Hammer,
	plan: ListChecks,
};

interface QuickActionsProps<Id extends QuickActionId> {
	/** The actions that apply to the row's pull request or issue, in the order offered. */
	actions: Id[];
	/** The action whose session is starting for it, if any. */
	pending: Id | null;
	onRun: (action: Id) => void;
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
						<MenuItem key={id} title={QUICK_ACTIONS[id].description} onClick={() => onRun(id)}>
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
				<Tooltip key={id} content={QUICK_ACTIONS[id].description}>
					<Button variant="secondary" size="compact" leadingIcon={ICON[id]} loading={pending === id} disabled={pending !== null} onClick={() => onRun(id)}>
						{QUICK_ACTIONS[id].label}
					</Button>
				</Tooltip>
			))}
		</div>
	);
}

interface NoticeProps {
	quick: StartOf<"quick">;
	onOpen: (view: View, mode: OpenMode) => void;
	onDismiss: () => void;
}

/** What became of the last quick action, with a button that forgets it: why its session did not start, or the session it started in the background, to open. */
export function QuickStartNotice({ quick, onOpen, onDismiss }: NoticeProps) {
	if (quick.phase === "starting") return null;
	const { subject } = quick.op;
	const name = subject.kind === "ticket" ? subject.id : `${subject.pr.owner}/${subject.pr.repo}#${subject.pr.number}`;
	const what = `"${QUICK_ACTIONS[subject.action].label}" on ${name}`;
	const failed = quick.phase === "failed";
	return (
		<p role={failed ? "alert" : "status"} className={cn("flex items-center gap-2 text-sm", failed ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
			<span className="min-w-0">{failed ? `Cannot start ${what}: ${quick.error}` : `Started ${what} in the background.`}</span>
			{quick.phase === "started" && (
				<Button
					variant="secondary"
					size="compact"
					className="shrink-0"
					title={`Open the session (${SPLIT_CLICK} to split)`}
					onClick={event => {
						onOpen(quick.view, modeOf(event));
						onDismiss();
					}}
				>
					Open session
				</Button>
			)}
			<Button variant="ghost" size="compact" className="shrink-0" onClick={onDismiss}>
				Dismiss
			</Button>
		</p>
	);
}
