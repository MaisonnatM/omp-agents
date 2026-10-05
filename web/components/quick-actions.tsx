import { CircleX, Eye, GitMerge, Hammer, ListChecks, type LucideIcon, MessageSquare, Radiation, Zap } from "lucide-react";
import type { View } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modeOf, SPLIT_CLICK } from "../labels";
import { actionOn, pendingOf, QUICK_ACTIONS, type QuickActionId, type QuickItem } from "../quick-actions";
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

interface QuickActionsProps {
	/** The actions that apply to the row's pull request or issue, in the order offered. */
	actions: QuickActionId[];
	/** The action whose session is starting for it, if any. */
	pending: QuickActionId | null;
	onRun(action: QuickActionId): void;
}

/** A row's menu of `actions`, named by `label`; nothing when there is none. */
export function QuickActionsMenu({ actions, pending, onRun, label }: QuickActionsProps & { label: string }) {
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
export function QuickActionButtons({ actions, pending, onRun }: QuickActionsProps) {
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

interface SheetActionsProps {
	/** What the sheet shows. */
	item: QuickItem;
	actions: QuickActionId[];
	onRun(action: QuickActionId): void;
	quick: StartOf<"quick"> | null;
	onOpen: (view: View, mode: OpenMode) => void;
	onDismiss: () => void;
}

/** A sheet's buttons for `actions` on `item`, then what became of the last quick action on it. */
export function SheetQuickActions({ item, actions, onRun, quick, onOpen, onDismiss }: SheetActionsProps) {
	return (
		<>
			<QuickActionButtons actions={actions} pending={pendingOf(quick, item)} onRun={onRun} />
			{quick && actionOn(quick.op.subject, item) !== null && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismiss} />}
		</>
	);
}
