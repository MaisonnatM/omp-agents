import { CircleX, Eye, GitMerge, type LucideIcon, MessageSquare, Radiation, Zap } from "lucide-react";
import type { InboxPullRequest } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { actionsFor, QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";

const ICON: Record<QuickActionId, LucideIcon> = {
	"fix-ci": CircleX,
	"resolve-conflicts": GitMerge,
	"address-comments": MessageSquare,
	review: Eye,
	"thermonuclear-review": Radiation,
};

interface QuickActionsProps {
	pr: InboxPullRequest;
	/** The action whose session is starting for this PR, if any. */
	pending: QuickActionId | null;
	onRun: (action: QuickActionId) => void;
}

const MENU_LABEL = "Quick actions: start a session in the background that works on this pull request";

/** A row's menu of the actions that apply to `pr`; nothing when none does. */
export function QuickActionsMenu({ pr, pending, onRun }: QuickActionsProps) {
	const actions = actionsFor(pr);
	if (actions.length === 0) return null;
	return (
		<DropdownMenu>
			<Tooltip content={MENU_LABEL}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={MENU_LABEL} loading={pending !== null} />}>
					<Zap />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				{actions.map(id => {
					const Icon = ICON[id];
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

/** The sheet's buttons for the actions that apply to `pr`; nothing when none does. One start at a time: all wait while one is pending. */
export function QuickActionButtons({ pr, pending, onRun }: QuickActionsProps) {
	const actions = actionsFor(pr);
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{actions.map(id => (
				<Tooltip key={id} content={QUICK_ACTIONS[id].description}>
					<Button
						variant="secondary"
						size="compact"
						leadingIcon={ICON[id]}
						loading={pending === id}
						disabled={pending !== null}
						onClick={() => onRun(id)}
					>
						{QUICK_ACTIONS[id].label}
					</Button>
				</Tooltip>
			))}
		</div>
	);
}
