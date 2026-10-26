import { Check, Copy, Ellipsis, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Link, RefreshCw, Users, X, Zap } from "lucide-react";
import { type PullRequest, type PullRequestDetail, type PullRequestSummary, prKey, pullRequestUrl, type SettableState } from "../../../src/shared/github";
import type { QueuedMerge } from "../../../src/shared/merge-queue";
import { MERGE_METHOD_LABELS, type MergeMethod } from "../../../src/shared/source-control";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLinkItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { graphiteUrl, rebaseApplies } from "../../pull-requests-model";
import { type RebaseState, useRebaseState } from "../../pull-request-rebases";
import { QUICK_ACTIONS } from "../../quick-actions";
import { useAction } from "../../use-action";
import { useCopy } from "../../use-copy";
import { useInlineConfirm } from "../../use-inline-confirm";
import { OrgIcon } from "../org-icon";
import type { QuickActionsProps } from "../quick-actions";
import { type PullRequestOptionsRead, type ReviewerChange, requestedLogins, reviewerChoices } from "./pr-fields";

export interface HeaderMergeMenu {
	allowed: MergeMethod[];
	method: MergeMethod | null;
	onPick: (method: MergeMethod) => void;
	queued: QueuedMerge | undefined;
	onCancel: () => void;
}

/** **Rebase on** its base, offered when {@link rebaseApplies} to `facts`, the pull request as its quick actions see it. */
export interface MenuRebase {
	facts: PullRequestSummary;
	run: () => void;
}

const REBASE_LABELS: Record<RebaseState, string> = { queued: "Queued to rebase", running: "Rebasing…" };

/** The **Reviewers** submenu's pull request, the people its repository offers, and how a pick asks one for a review or withdraws it. */
export interface MenuReviewers {
	pr: Pick<PullRequestSummary, "author" | "reviewers">;
	options: PullRequestOptionsRead;
	onChange: (change: ReviewerChange) => void;
}

export interface PullRequestMenuItemsProps {
	pr: PullRequest;
	state: PullRequestDetail["state"] | null;
	quick: QuickActionsProps;
	onState: (to: SettableState) => void;
	merge?: HeaderMergeMenu;
	rebase?: MenuRebase | null;
	reviewers?: MenuReviewers;
	pending?: boolean;
}

interface PullRequestMenuProps extends PullRequestMenuItemsProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	label: string;
}

export function PullRequestMenu({ open, onOpenChange, label, ...items }: PullRequestMenuProps) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip content={label}>
				<DropdownMenuTrigger render={<Button variant="ghost-muted" size="icon-xs" aria-label={label} loading={items.quick.pending !== null || !!items.pending} />}><Ellipsis /></DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-56">
				<PullRequestMenuItems {...items} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The **Reviewers** submenu: the people a review can be asked of, read when it first opens, each a pick that asks them or withdraws the request. */
function ReviewersSubmenu({ pr, options, onChange }: MenuReviewers) {
	const people = reviewerChoices(pr, options);
	const requested = requestedLogins(pr.reviewers);
	return (
		<MenuSubmenu onOpenChange={next => { if (next) options.open(); }}>
			<MenuSubmenuTrigger><Users />Reviewers</MenuSubmenuTrigger>
			<MenuSubmenuContent>
				{people === null && <MenuItem disabled className={cn(options.error && "text-red-600 dark:text-red-400")}>{options.error ?? "Loading reviewers…"}</MenuItem>}
				{people?.length === 0 && <MenuItem disabled>No one to ask</MenuItem>}
				{people?.map(person => {
					const on = requested.includes(person.login);
					return (
						<MenuItem key={person.login} closeOnClick={false} onClick={() => onChange({ field: "reviewer", login: person.login, on: !on })}>
							<span className="truncate">{person.login}</span>
							{on && <span className="sr-only">, review requested</span>}
							<Check aria-hidden className={cn("ml-auto", on ? "opacity-100" : "opacity-0")} />
						</MenuItem>
					);
				})}
			</MenuSubmenuContent>
		</MenuSubmenu>
	);
}

/** The pull request's actions, as its `⋯` menu and its row's right-click menu both list them. */
export function PullRequestMenuItems({ pr, state, quick, onState, merge, rebase, reviewers, pending = false }: PullRequestMenuItemsProps) {
	const confirm = useInlineConfirm(prKey(pr));
	const rebasing = useRebaseState(pr);
	const offersRebase = !!rebase && rebaseApplies(rebase.facts);
	const { copy } = useCopy();
	const clipboard = useAction(async (value: string) => { await copy(value); }, "Could not copy");
	const changesState = state === "open" || state === "draft";
	const endAction = state === "closed" ? "reopen" : "close";
	const confirmLabel = endAction === "close" ? "Confirm close?" : "Confirm reopen?";
	const endLabel = confirm.isArmed(endAction) ? confirmLabel : state === "closed" ? "Reopen pull request" : "Close pull request";
	return (
		<>
			{quick.actions.map(id => <MenuItem key={id} title={QUICK_ACTIONS[id].description} disabled={quick.pending !== null} onClick={() => quick.onRun(id)}><Zap />{QUICK_ACTIONS[id].label}</MenuItem>)}
			{offersRebase && (
				<MenuItem title="Rebase the branch on its base, run the repository's pre-push checks, and push it with --force-with-lease" disabled={rebasing !== null} onClick={rebase.run}>
					<RefreshCw />{rebasing ? REBASE_LABELS[rebasing] : `Rebase on ${rebase.facts.base}`}
				</MenuItem>
			)}
			{(quick.actions.length > 0 || offersRebase) && <MenuSeparator />}
			{changesState && merge && merge.allowed.length > 1 && <>
				<MenuRadioGroup aria-label="Merge method" value={merge.method ?? ""} onValueChange={value => { const method = merge.allowed.find(candidate => candidate === value); if (method) merge.onPick(method); }}>
					{merge.allowed.map(method => <MenuRadioItem key={method} value={method} disabled={pending || !!merge.queued} closeOnClick><GitMerge />{MERGE_METHOD_LABELS[method]}</MenuRadioItem>)}
				</MenuRadioGroup>
				<MenuSeparator />
			</>}
			{changesState && <MenuItem disabled={pending} onClick={() => onState(state === "draft" ? "open" : "draft")}>
				{state === "draft" ? <GitPullRequest /> : <GitPullRequestDraft />}{state === "draft" ? "Ready for review" : "Convert to draft"}
			</MenuItem>}
			{changesState && reviewers && <ReviewersSubmenu {...reviewers} />}
			{merge?.queued && <MenuItem disabled={pending} onClick={merge.onCancel}><X />{merge.queued.state.kind === "failed" ? "Dismiss stopped merge" : "Cancel merge when ready"}</MenuItem>}
			{(changesState || merge?.queued) && <MenuSeparator />}
			<MenuLinkItem href={pullRequestUrl(pr)} target="_blank" rel="noreferrer"><OrgIcon org="github" className="size-4" />Open on GitHub</MenuLinkItem>
			<MenuLinkItem href={graphiteUrl(pr)} target="_blank" rel="noreferrer"><OrgIcon org="graphite" className="size-4" />Open on Graphite</MenuLinkItem>
			<MenuItem onClick={() => clipboard.run(pullRequestUrl(pr))}><Link />Copy link</MenuItem>
			<MenuItem onClick={() => clipboard.run(`#${pr.number}`)}><Copy />Copy PR number</MenuItem>
			{state && state !== "merged" && <>
				<MenuSeparator />
				<MenuItem variant={state === "closed" ? "default" : "destructive"} disabled={pending} closeOnClick={confirm.isArmed(endAction)} aria-label={endLabel} {...confirm.props(endAction, () => onState(state === "closed" ? "open" : "closed"))}>
					{state === "closed" ? <GitPullRequest /> : <GitPullRequestClosed />}{endLabel}
				</MenuItem>
			</>}
		</>
	);
}
