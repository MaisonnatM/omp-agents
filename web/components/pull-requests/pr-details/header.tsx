/** `DetailHeader`: a pull request's name, author, branches, and size, with the Next move button and the `⋯` menu. */
import { ArrowLeft, Check, Copy, Ellipsis, ExternalLink, FileDiff, GitMerge, Layers, Zap } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { MERGE_METHOD_LABELS, type MergeMethod, startingMethod } from "../../../../src/shared/source-control";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLastMergeMethod, useMergeMethodChoice } from "../../../merge-method";
import type { SavePullRequest } from "../pr-fields";
import { type PullRequest, type PullRequestDetail, pullRequestName, pullRequestUrl, type StackedPullRequest } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { graphiteUrl } from "../../../pull-requests-model";
import { age, modeOf } from "../../../labels";
import { QUICK_ACTIONS, type QuickActionId } from "../../../quick-actions";
import { useCopy } from "../../../use-copy";
import { BranchLabel, BranchName } from "../../git";
import { OrgIcon } from "../../org-icon";
import { QuickActionButton, type QuickActionsProps } from "../../quick-actions";
import { Avatar, IconTip, STATE_ICON } from "../avatars";
import { MoveBadge } from "../pr-row";
import type { DetailContentProps, NextMove, Placement } from ".";

/** Merges on GitHub with the method Settings starts it on, after a confirmation that can switch the method. */
function MergeButton({ pr, detail, onSave }: { pr: PullRequest; detail: PullRequestDetail; onSave: SavePullRequest }) {
	const [choice] = useMergeMethodChoice();
	const [last, setLast] = useLastMergeMethod();
	const [open, setOpen] = useState(false);
	const [picked, setPicked] = useState<MergeMethod | null>(null);
	const method = picked && detail.mergeMethods.includes(picked) ? picked : startingMethod(choice, last, detail.mergeMethods);
	if (!method)
		return (
			<Button variant="primary" size="compact" leadingIcon={GitMerge} render={<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" />}>
				Merge on GitHub
			</Button>
		);
	const merge = (): void => {
		setLast(method);
		setOpen(false);
		onSave({ field: "merge", method, head: detail.headOid }, {});
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="primary" size="compact" leadingIcon={GitMerge} active={open}>
					{MERGE_METHOD_LABELS[method]}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 space-y-3 p-3">
				<p className="text-[13px] text-pretty">
					Merge {pullRequestName(pr)} into <span className="font-mono">{detail.base}</span> on GitHub?
				</p>
				{detail.mergeMethods.length > 1 && (
					<RadioGroup aria-label="Merge method" value={method} onValueChange={value => setPicked(detail.mergeMethods.find(allowed => allowed === value) ?? null)} className="space-y-1">
						{detail.mergeMethods.map(allowed => (
							<label key={allowed} className="flex cursor-pointer items-center gap-2 text-[13px]">
								<Radio.Root value={allowed} className="flex size-3.5 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary">
									<Radio.Indicator className="size-1.5 rounded-full bg-background" />
								</Radio.Root>
								{MERGE_METHOD_LABELS[allowed]}
							</label>
						))}
					</RadioGroup>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="compact" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button variant="primary" size="compact" leadingIcon={GitMerge} onClick={merge}>
						{MERGE_METHOD_LABELS[method]}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** The Next move's one button, as the header's primary action. */
function NextMoveButton({ pr, detail, next, quick, onOpen, onSave }: { pr: PullRequest; detail: PullRequestDetail | null; next: NextMove; quick: QuickActionsProps; onOpen: DetailContentProps["onOpen"]; onSave: SavePullRequest }) {
	const { move, reason, action, session } = next;
	let button: ReactNode = null;
	if (action) button = <QuickActionButton action={action} pending={quick.pending} onRun={quick.onRun} primary />;
	else if (move === "merge")
		button = detail ? (
			<MergeButton pr={pr} detail={detail} onSave={onSave} />
		) : (
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
	onSave: SavePullRequest;
	placement: Placement;
	/** The heading, which takes focus on the page. */
	headingRef: RefObject<HTMLHeadingElement | null>;
}

/** The header: the pull request's name, author, branches, and size, with the Next move's button and the `⋯` menu. */
export function DetailHeader({ pr, detail, stack, next, actions, quick, onOpen, onSave, placement, headingRef }: DetailHeaderProps) {
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
					{next && <NextMoveButton pr={pr} detail={detail} next={next} quick={quick} onOpen={onOpen} onSave={onSave} />}
					<MoreMenu pr={pr} actions={actions} quick={quick} />
				</span>
			</div>
			<Heading ref={headingRef} tabIndex={-1} className={cn(page ? "text-xl" : "text-base", "leading-snug font-semibold outline-none")}>
				{detail?.title ?? pullRequestName(pr)}
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
