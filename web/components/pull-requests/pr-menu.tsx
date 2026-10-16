/** A pull request's `⋯` menu, on its rows and in its details' header. */
import { Ellipsis, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon, Zap } from "lucide-react";
import { type PullRequest, type PullRequestDetail, pullRequestUrl, type SettableState } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { graphiteUrl, STATE_ACTIONS, type StateActionId, stateActions } from "../../pull-requests-model";
import { QUICK_ACTIONS } from "../../quick-actions";
import { OrgIcon } from "../org-icon";
import type { QuickActionsProps } from "../quick-actions";

const STATE_ACTION_ICON: Record<StateActionId, LucideIcon> = { ready: GitPullRequest, draft: GitPullRequestDraft, close: GitPullRequestClosed, reopen: GitPullRequest };

interface PullRequestMenuProps {
	pr: PullRequest;
	/** Where it stands on GitHub, for the state changes it offers; `null` while unknown offers none. */
	state: PullRequestDetail["state"] | null;
	quick: QuickActionsProps;
	onState: (to: SettableState) => void;
	/** A state change or merge is on its way to GitHub. */
	pending: boolean;
	/** With `onOpenChange`, lets a keyboard shortcut open it; without them it keeps its own state. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	label: string;
}

/** The quick actions, then the state changes GitHub takes, then the pull request on GitHub and Graphite. */
export function PullRequestMenu({ pr, state, quick, onState, pending, open, onOpenChange, label }: PullRequestMenuProps) {
	const changes = state ? stateActions(state) : [];
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip content={label}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={label} loading={quick.pending !== null || pending} />}>
					<Ellipsis />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-56">
				{quick.actions.map(id => (
					<MenuItem key={id} title={QUICK_ACTIONS[id].description} disabled={quick.pending !== null} onClick={() => quick.onRun(id)}>
						<Zap />
						{QUICK_ACTIONS[id].label}
					</MenuItem>
				))}
				{quick.actions.length > 0 && <MenuSeparator />}
				{changes.map(id => {
					const Icon = STATE_ACTION_ICON[id];
					return (
						<MenuItem key={id} disabled={pending} onClick={() => onState(STATE_ACTIONS[id].to)}>
							<Icon />
							{STATE_ACTIONS[id].label}
						</MenuItem>
					);
				})}
				{changes.length > 0 && <MenuSeparator />}
				<MenuLinkItem href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
					<OrgIcon org="github" className="size-4" />
					Open on GitHub
				</MenuLinkItem>
				<MenuLinkItem href={graphiteUrl(pr)} target="_blank" rel="noreferrer">
					<OrgIcon org="graphite" className="size-4" />
					Open on Graphite
				</MenuLinkItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
