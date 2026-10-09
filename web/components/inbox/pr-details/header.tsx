import { ArrowLeft, Check, Copy, Ellipsis, ExternalLink, FileDiff, GitMerge, Layers, Zap } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { type PullRequest, type PullRequestDetail, pullRequestUrl, type StackedPullRequest } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { graphiteUrl } from "../../../inbox-model";
import { age, modeOf } from "../../../labels";
import { QUICK_ACTIONS, type QuickActionId } from "../../../quick-actions";
import { useCopy } from "../../../use-copy";
import { BranchLabel, BranchName } from "../../git";
import { OrgIcon } from "../../org-icon";
import { QuickActionButton, type QuickActionsProps } from "../../quick-actions";
import { Avatar, IconTip, STATE_ICON } from "../avatars";
import { MoveBadge } from "../pr-row";
import type { DetailContentProps, NextMove, Placement } from ".";

/** The Next move's one button, as the header's primary action. */
function NextMoveButton({ pr, next, quick, onOpen }: { pr: PullRequest; next: NextMove; quick: QuickActionsProps; onOpen: DetailContentProps["onOpen"] }) {
	const { move, reason, action, session } = next;
	let button: ReactNode = null;
	if (action) button = <QuickActionButton action={action} pending={quick.pending} onRun={quick.onRun} primary />;
	else if (move === "merge")
		button = (
			<Button variant="primary" size="compact" leadingIcon={GitMerge} render={<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" />}>
				Merge on GitHub
			</Button>
		);
	else if (session)
		button = (
			<Button variant="primary" size="compact" onClick={event => onOpen({ kind: "live", instanceId: session.instanceId, agentId: null }, modeOf(event))}>
				Open the session
			</Button>
		);
	return (
		<span className="flex items-center gap-2">
			<Tooltip content={reason}>
				<span>
					<MoveBadge move={move} />
				</span>
			</Tooltip>
			{button}
		</span>
	);
}

/** The header's `⋯`: the quick actions the Next move does not make, then the pull request elsewhere. */
function MoreMenu({ pr, actions, quick }: { pr: PullRequest; actions: QuickActionId[]; quick: QuickActionsProps }) {
	return (
		<DropdownMenu>
			<Tooltip content="More actions">
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label="More actions" loading={quick.pending !== null} />}>
					<Ellipsis />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-56">
				{actions.map(id => (
					<MenuItem key={id} title={QUICK_ACTIONS[id].description} onClick={() => quick.onRun(id)}>
						<Zap />
						{QUICK_ACTIONS[id].label}
					</MenuItem>
				))}
				{actions.length > 0 && <MenuSeparator />}
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

function CheckoutCommand({ pr }: { pr: PullRequest }) {
	const { copied, copy } = useCopy();
	const command = `gh pr checkout ${pr.number}`;
	return (
		<Tooltip content={copied ? "Copied" : "Copy the command"}>
			<button type="button" onClick={() => copy(command)} className="group flex shrink-0 items-center gap-1.5 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
				{copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3 opacity-0 group-hover:opacity-100" />}
				{command}
			</button>
		</Tooltip>
	);
}

interface DetailHeaderProps {
	pr: PullRequest;
	/** What GitHub says of it; `null` until it answers. */
	detail: PullRequestDetail | null;
	stack: StackedPullRequest[];
	next: NextMove | null;
	/** The quick actions for the `⋯` menu. */
	actions: QuickActionId[];
	quick: QuickActionsProps;
	onOpen: DetailContentProps["onOpen"];
	placement: Placement;
	/** The heading, which takes focus on the page. */
	headingRef: RefObject<HTMLHeadingElement | null>;
}

/** The header: the pull request's name, author, branches, and size, with the Next move's button and the `⋯` menu. */
export function DetailHeader({ pr, detail, stack, next, actions, quick, onOpen, placement, headingRef }: DetailHeaderProps) {
	const page = placement === "page";
	const Heading = page ? "h1" : "h3";
	const stackedBase = detail && stack.length > 0 && stack.at(-1)?.number !== pr.number;
	return (
		<header className={cn("space-y-2 border-b border-border pb-4", page ? "px-6 pt-5" : "pt-1")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
				<p className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
					{detail && <IconTip icon={STATE_ICON[detail.state]} />}
					<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate hover:text-foreground">
						{pr.owner}/{pr.repo} <span className="text-emerald-700 dark:text-emerald-400">#{pr.number}</span>
						<ExternalLink aria-hidden className="size-3" />
					</a>
				</p>
				<span className="ml-auto flex shrink-0 items-center gap-1.5">
					{next && <NextMoveButton pr={pr} next={next} quick={quick} onOpen={onOpen} />}
					<MoreMenu pr={pr} actions={actions} quick={quick} />
				</span>
			</div>
			<Heading ref={headingRef} tabIndex={-1} className={cn(page ? "text-xl" : "text-base", "leading-snug font-semibold outline-none")}>
				{detail?.title ?? `${pr.owner}/${pr.repo}#${pr.number}`}
			</Heading>
			{detail && (
				<>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
						<span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
							<Avatar person={detail.author} label={`Opened by ${detail.author.login}`} />
							<span className="truncate text-foreground">{detail.author.login}</span>
							<span aria-hidden>·</span>
							<Tooltip content={`Opened ${new Date(detail.createdAt).toLocaleString()}`}>
								<span>updated {age(detail.updatedAt)} ago</span>
							</Tooltip>
						</span>
						<span className="ml-auto whitespace-nowrap">
							<CheckoutCommand pr={pr} />
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span className="flex min-w-0 max-w-full items-center gap-1.5">
							{stackedBase ? (
								<span className="flex min-w-0 items-center gap-1 text-amber-700 dark:text-amber-400">
									<Layers aria-hidden className="size-3.5 shrink-0" />
									<BranchLabel name={detail.base} title className="max-w-64 font-mono" />
								</span>
							) : (
								<BranchLabel name={detail.base} title className="max-w-64 font-mono" />
							)}
							<ArrowLeft aria-label="from" className="size-3 shrink-0" />
							<BranchName name={detail.head} className="font-mono" />
						</span>
						<span className="ml-auto flex items-center gap-2 tabular-nums">
							<FileDiff aria-hidden className="size-3.5" />
							{detail.changedFiles} {detail.changedFiles === 1 ? "file" : "files"}
							<span className="font-mono">
								<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions.toLocaleString()}</span>{" "}
								<span className="text-red-600 dark:text-red-400">−{detail.deletions.toLocaleString()}</span>
							</span>
						</span>
					</div>
				</>
			)}
		</header>
	);
}
