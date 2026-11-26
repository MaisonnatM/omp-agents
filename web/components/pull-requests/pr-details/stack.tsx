/** A pull request's stack and its session's other pull requests: the popover that a session's header and the pull request header both open. */
import { IconMerged, IconPullRequest } from "central-icons";
import { type MouseEvent, type ReactElement, type ReactNode, useState } from "react";
import { type LinkedPullRequest, type PullRequest, type PullRequestDetail, prKey, pullRequestUrl, type StackedPullRequest, samePullRequest } from "../../../../src/shared/github";
import { queuedMergeOf } from "../../../../src/shared/merge-queue";
import { age, LINK_VERB } from "../../../labels";
import { hashForPullRequests } from "../../../routing";
import { usePageHash } from "../../../page-hash";
import { useRead } from "../../../reads";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { useDashboardStatus } from "../../dashboard-context";
import { OrgIcon } from "../../org-icon";
import { Rail, RailRow } from "../../rail";
import { Avatar, IconTip, STATE_ICON } from "../avatars";
import { MergePopover, QueuedMergeNote, useMergeTarget } from "../merge-popover";
import { ChecksIcon } from "../pr-row";
import { useCancelMerge } from "../use-merge-controller";

interface StackPopoverProps {
	/** The stack, top first; empty when the pull request stacks on nothing. */
	stack: StackedPullRequest[];
	/** The session's pull requests outside the stack. */
	others: LinkedPullRequest[];
	/** The one marked as here, which links nowhere. */
	current?: PullRequest;
	/** Shows a picked pull request in place; without it each links to its details. */
	onPick?: (pr: PullRequest) => void;
	align: "start" | "end";
	/** The button that opens the popover, given whether it is open. */
	trigger: (open: boolean) => ReactElement;
}

/** The stack on its rail with **Merge stack**, then the session's other pull requests, each with its GitHub link. */
export function StackPopover({ stack, others, current, onPick, align, trigger }: StackPopoverProps) {
	const [open, setOpen] = useState(false);
	const top = stack[0];
	const pick = onPick && ((pr: PullRequest) => {
		setOpen(false);
		onPick(pr);
	});
	// A link in the popover leaves the page or opens a tab; either way the popover is done.
	const closeOnLink = (event: MouseEvent): void => {
		if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger render={trigger(open)} />
			<PopoverContent align={align} className="max-h-(--available-height) w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-0" onClick={closeOnLink}>
				{top && <StackRail stack={stack} current={current} onPick={pick} trailing={pr => <GithubLink pr={pr} />} />}
				{top && <MergeStack stack={stack} align={align} />}
				{others.length > 0 && (
					<div className={top ? "border-t border-border py-1" : "py-1"}>
						{top && <p className="px-3 pt-1 pb-0.5 text-xs text-muted-foreground">Also on this session</p>}
						<ul>
							{others.map(pr => <OtherRow key={prKey(pr)} pr={pr} onPick={pick} />)}
						</ul>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** One of the session's other pull requests: its state, number and title once GitHub answers, and how the session touched it. */
function OtherRow({ pr, onPick }: { pr: LinkedPullRequest; onPick?: (pr: PullRequest) => void }) {
	const to = usePageHash();
	const read = useRead<Pick<PullRequestDetail, "title" | "state">>(`/api/pull-request/title?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`);
	const label = (
		<>
			<span className="text-muted-foreground tabular-nums">#{pr.number}</span> {read.data?.title ?? pr.repo}
		</>
	);
	const name = `#${pr.number} ${read.data?.title ?? pr.repo}\nThis session ${LINK_VERB[pr.link]} it`;
	return (
		<li className="flex items-center gap-2 py-1.5 pr-3 pl-3 text-sm">
			{read.data ? <IconTip icon={STATE_ICON[read.data.state]} className="[&_svg]:size-3.5" /> : <IconPullRequest className="size-3.5 shrink-0 text-muted-foreground" />}
			{onPick ? (
				<button type="button" title={name} onClick={() => onPick(pr)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
					{label}
				</button>
			) : (
				<a href={hashForPullRequests(pr, to)} title={name} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
					{label}
				</a>
			)}
			<GithubLink pr={pr} />
		</li>
	);
}

/** **Merge stack**: queues the stack's merge, bottom first, after the merge confirmation; once queued, where it stands, with **Cancel**. */
function MergeStack({ stack, align }: { stack: StackedPullRequest[]; align: "start" | "end" }) {
	const { merges } = useDashboardStatus();
	const [open, setOpen] = useState(false);
	const bottom = stack[stack.length - 1]!;
	const target = useMergeTarget(bottom, open);
	const queued = stack.map(pr => queuedMergeOf(merges, pr)).find(merge => merge !== undefined);
	const cancel = useCancelMerge(queued);
	return (
		<div className="border-t border-border px-3 py-2">
			{queued ? (
				<QueuedMergeNote merge={queued} cancel={cancel} />
			) : (
				<MergePopover pr={bottom} stack={stack} target={target.data} error={target.error} open={open} onOpenChange={setOpen} align={align}>
					{({ pending }) => (
						<Button variant="secondary" size="compact" leadingIcon={IconMerged} active={open} loading={pending}>
							Merge stack
						</Button>
					)}
				</MergePopover>
			)}
		</div>
	);
}

/** A pull request's GitHub page, as an icon link at the end of its row. */
function GithubLink({ pr }: { pr: PullRequest }) {
	return (
		<Tooltip content={`#${pr.number} on GitHub`}>
			<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" aria-label={`#${pr.number} on GitHub`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
				<OrgIcon org="github" className="size-3.5" />
			</a>
		</Tooltip>
	);
}

interface StackRailProps {
	stack: StackedPullRequest[];
	/** The one marked as here, which links nowhere. */
	current?: PullRequest;
	onPick?: (pr: PullRequest) => void;
	/** What ends each row, after its checks and age. */
	trailing?: (pr: StackedPullRequest) => ReactNode;
	className?: string;
}

/** `stack`, top first, on a rail down to the branch the bottom one merges into; each one but `current` links to its details, or `onPick` shows it in place. */
export function StackRail({ stack, current, onPick, trailing, className }: StackRailProps) {
	const to = usePageHash();
	const bottom = stack[stack.length - 1];
	if (!bottom) return null;
	return (
		<Rail end={bottom.base} className={className}>
			{stack.map((pr, index) => {
				const here = current !== undefined && samePullRequest(pr, current);
				const label = `#${pr.number} ${pr.title}`;
				return (
					<RailRow key={pr.number} first={index === 0} here={here}>
						<Avatar person={pr.author} label={pr.author.login} />
						{here ? (
							<span aria-current="page" className="min-w-0 flex-1 truncate font-medium">
								{label}
							</span>
						) : onPick ? (
							<button type="button" onClick={() => onPick(pr)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
								{label}
							</button>
						) : (
							<a href={hashForPullRequests(pr, to)} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
								{label}
							</a>
						)}
						<ChecksIcon checks={pr.checks} />
						<span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{age(pr.updatedAt, { compact: true })}</span>
						{trailing?.(pr)}
					</RailRow>
				);
			})}
		</Rail>
	);
}
