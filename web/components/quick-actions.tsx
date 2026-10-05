import { CircleX, Eye, GitMerge, Hammer, ListChecks, type LucideIcon, MessageSquare, Radiation, Zap } from "lucide-react";
import type { RosterHost, View } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";

import { QUICK_ACTIONS, type QuickActionId } from "../quick-actions";
import type { OpenMode } from "../routing";
import type { StartOf } from "../starts";
import { LiveSessionChips } from "./session-chip";

const ICON: Record<QuickActionId, LucideIcon> = {
	"fix-ci": CircleX,
	"resolve-conflicts": GitMerge,
	"address-comments": MessageSquare,
	review: Eye,
	"thermonuclear-review": Radiation,
	work: Hammer,
	plan: ListChecks,
};

export interface QuickActionsProps {
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
				<DropdownMenuTrigger render={<Button variant="agent" size="icon-compact" aria-label={label} loading={pending !== null} />}>
					<Zap />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				{actions.map(id => {
					const Icon: LucideIcon = ICON[id];
					return (
						<MenuItem variant="agent" key={id} title={QUICK_ACTIONS[id].description} onClick={() => onRun(id)}>
							<Icon />
							{QUICK_ACTIONS[id].label}
						</MenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** One quick action's button, which waits while any start on the same item is pending. */
export function QuickActionButton({ action, pending, onRun }: { action: QuickActionId } & Omit<QuickActionsProps, "actions">) {
	return (
		<Tooltip content={QUICK_ACTIONS[action].description}>
			<Button variant="agent" size="compact" leadingIcon={ICON[action]} loading={pending === action} disabled={pending !== null} onClick={() => onRun(action)}>
				{QUICK_ACTIONS[action].label}
			</Button>
		</Tooltip>
	);
}

/** A sheet's buttons for `actions`; nothing when there is none. One start at a time: all wait while one is pending. */
export function QuickActionButtons({ actions, pending, onRun }: QuickActionsProps) {
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{actions.map(id => (
				<QuickActionButton key={id} action={id} pending={pending} onRun={onRun} />
			))}
		</div>
	);
}

interface NoticeProps {
	quick: StartOf<"quick">;
	onDismiss: () => void;
}

/** Why the last quick action's session did not start, with a button that forgets it; nothing while it starts. */
export function QuickStartNotice({ quick, onDismiss }: NoticeProps) {
	if (quick.phase !== "failed") return null;
	const { subject } = quick.op;
	const name = subject.kind === "ticket" ? subject.id : `${subject.pr.owner}/${subject.pr.repo}#${subject.pr.number}`;
	return (
		<p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
			<span className="min-w-0">
				Cannot start "{QUICK_ACTIONS[subject.action].label}" on {name}: {quick.error}
			</span>
			<Button variant="ghost" size="compact" className="shrink-0" onClick={onDismiss}>
				Dismiss
			</Button>
		</p>
	);
}

interface SheetActionsProps extends QuickActionsProps {
	/** The running sessions that work on the sheet's pull request or issue. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
}

/** A sheet's buttons for `actions`, then the sessions that work on its item; nothing when there is neither. */
export function SheetQuickActions({ actions, pending, onRun, sessions, onOpen }: SheetActionsProps) {
	if (actions.length === 0 && sessions.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			<QuickActionButtons actions={actions} pending={pending} onRun={onRun} />
			<LiveSessionChips hosts={sessions} onOpen={onOpen} />
		</div>
	);
}
