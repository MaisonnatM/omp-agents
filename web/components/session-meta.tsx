/** The subagent header's crumb styles, and a session header's controls: its branch, its Linear issues, and its pull requests. */
import { Check, ChevronDown, Copy, GitMerge, GitPullRequest, Layers } from "lucide-react";
import { Fragment, type MouseEvent, useEffect, useState } from "react";
import { type LinkedPullRequest, type PullRequest, prKey, pullRequestUrl, type StackedPullRequest } from "../../src/shared/github";
import { queuedMergeOf } from "../../src/shared/merge-queue";
import type { SessionFacts } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { LINK_VERB } from "../labels";
import { graphiteUrl, sessionStack } from "../pull-requests-model";
import { PAGE_ICON } from "../page-icons";
import { ticketsStore, useRead } from "../reads";
import { hashForPullRequests, hashForTickets } from "../routing";
import { linearUrlOf } from "../tickets-model";
import { BrandMark, LINEAR_LOGO } from "./integrations/brand-logos";
import { BranchName, releaseBranch } from "./git";
import { StackRail } from "./pull-requests/pr-details/stack";
import { MergePopover, QueuedMergeNote, useMergeTarget } from "./pull-requests/merge-popover";
import { useCancelMerge } from "./pull-requests/use-merge-controller";
import { useDashboardStatus } from "./dashboard-context";
import { OrgIcon } from "./org-icon";
import { useCopy } from "../use-copy";

export const PARENT_CRUMB = "font-normal text-muted-foreground";
export const CRUMB_SEPARATOR = "px-1.5 font-normal text-muted-foreground/60";
const TicketsIcon = PAGE_ICON.tickets;
const NO_TICKETS: never[] = [];

/** A session header's controls before its own buttons: the branch it works on, which copies its name and removes its linked worktree when clicked; its Linear issues; and its pull requests. */
export function SessionMeta({ facts }: { facts: Pick<SessionFacts, "tickets" | "pullRequests" | "branch"> & { cwd: string } }) {
	const { branch, cwd } = facts;
	return (
		<>
			{branch && <BranchName name={branch.name} onCopy={() => releaseBranch(cwd, branch.name)} className="max-w-48 font-mono text-xs text-muted-foreground" />}
			<TicketMenu tickets={facts.tickets} />
			<PullRequestButton pullRequests={facts.pullRequests} />
		</>
	);
}

/** A session header's ID, as an icon button right after its title that copies the ID. */
export function SessionIdCopy({ id }: { id: string }) {
	const { copied, copy } = useCopy();
	const Icon = copied ? Check : Copy;
	const label = copied ? "Copied" : `Copy session ID ${id}`;
	return (
		<Tooltip content={label}>
			<Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => copy(id)} className="text-muted-foreground">
				<Icon aria-hidden />
			</Button>
		</Tooltip>
	);
}

/**
 * The PRs a session submitted or worked on, behind one button whose popover lists them, each opening in its details on the Pull requests page, on GitHub,
 * or on Graphite. When two or more of them stack, the button says so and the popover shows the stack on its rail, the session's other PRs below it.
 */
function PullRequestButton({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
	const [open, setOpen] = useState(false);
	const [first] = pullRequests;
	const query = first && pullRequests.length > 1 ? new URLSearchParams({ owner: first.owner, repo: first.repo, number: String(first.number) }) : null;
	// Read again when the session links another PR, which may join the stack.
	const stackRead = useRead<StackedPullRequest[]>(query && `/api/pull-request/stack?${query}`, pullRequests.map(prKey).join());
	if (!first) return null;
	const stacked = sessionStack(pullRequests, stackRead.data ?? []);
	const others = stacked?.others ?? pullRequests;
	const top = stacked?.stack[0];
	// A link in the popover leaves the page or opens a tab; either way the popover is done.
	const closeOnLink = (event: MouseEvent): void => {
		if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="secondary" size="compact" leadingIcon={stacked ? Layers : GitPullRequest} trailingIcon={ChevronDown} active={open}>
					{stacked ? (
						<>
							Stack <span className="text-muted-foreground tabular-nums">· {stacked.stack.length}</span>
						</>
					) : (
						<>
							#{first.number}
							{others.length > 1 && <span className="text-muted-foreground">+{others.length - 1}</span>}
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[28rem] p-0" onClick={closeOnLink}>
				{stacked && <StackRail stack={stacked.stack} trailing={pr => <ExternalLinks pr={pr} />} />}
				{stacked && <MergeStack stack={stacked.stack} />}
				{others.length > 0 && (
					<div className={stacked ? "border-t border-border py-1" : "py-1"}>
						{stacked && <p className="px-3 pt-1 pb-0.5 text-xs text-muted-foreground">Also on this session</p>}
						<ul>
							{others.map(pr => (
								<li key={prKey(pr)} className="flex items-center gap-2 py-1.5 pr-3 pl-3 text-sm">
									<GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
									<a href={hashForPullRequests(pr)} className="min-w-0 flex-1 truncate tabular-nums underline-offset-2 hover:underline">
										{pr.repo} #{pr.number}
									</a>
									<span className="shrink-0 text-xs text-muted-foreground">{LINK_VERB[pr.link]}</span>
									<ExternalLinks pr={pr} />
								</li>
							))}
						</ul>
					</div>
				)}
				{top && (
					<a href={graphiteUrl(top)} target="_blank" rel="noreferrer" className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm hover:bg-muted">
						<OrgIcon org="graphite" className="size-4" />
						Open stack on Graphite
					</a>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** **Merge stack**: queues the stack's merge, bottom first, after the merge confirmation; once queued, where it stands, with **Cancel**. */
function MergeStack({ stack }: { stack: StackedPullRequest[] }) {
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
				<MergePopover pr={bottom} stack={stack} target={target.data} error={target.error} open={open} onOpenChange={setOpen} align="end">
					{({ pending }) => (
						<Button variant="secondary" size="compact" leadingIcon={GitMerge} active={open} loading={pending}>
							Merge stack
						</Button>
					)}
				</MergePopover>
			)}
		</div>
	);
}

/** A pull request's GitHub and Graphite pages, as icon links at the end of its row. */
function ExternalLinks({ pr }: { pr: PullRequest }) {
	const link = "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground";
	return (
		<span className="flex shrink-0 items-center">
			<Tooltip content={`#${pr.number} on GitHub`}>
				<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" aria-label={`#${pr.number} on GitHub`} className={link}>
					<OrgIcon org="github" className="size-3.5" />
				</a>
			</Tooltip>
			<Tooltip content={`#${pr.number} on Graphite`}>
				<a href={graphiteUrl(pr)} target="_blank" rel="noreferrer" aria-label={`#${pr.number} on Graphite`} className={link}>
					<OrgIcon org="graphite" className="size-3.5" />
				</a>
			</Tooltip>
		</span>
	);
}

/**
 * The Linear issues a session worked on, behind one button: each opens on Linear, when the assigned issues name its
 * workspace, or on the Tickets page.
 */
function TicketMenu({ tickets }: { tickets: string[] }) {
	const [open, setOpen] = useState(false);
	const listed = ticketsStore.use().read?.data.tickets ?? NO_TICKETS;
	const [first] = tickets;
	const linked = first !== undefined;
	// The assigned issues name the Linear workspace, which the Linear links need.
	useEffect(() => {
		if (linked) ticketsStore.ensure();
	}, [linked]);
	if (!first) return null;
	const more = tickets.length - 1;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={more > 0 ? `This session's ${tickets.length} Linear issues` : `Linear issue ${first}`} forceOpen={open ? false : undefined} side="bottom">
				<DropdownMenuTrigger render={<Button variant="secondary" size="compact" leadingIcon={TicketsIcon} trailingIcon={ChevronDown} active={open} />}>
					{first}
					{more > 0 && <span className="text-muted-foreground">+{more}</span>}
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				{tickets.map((id, index) => {
					const url = linearUrlOf(id, listed);
					return (
						<Fragment key={id}>
							{index > 0 && <MenuSeparator />}
							{url && (
								<MenuLinkItem href={url} target="_blank" rel="noreferrer">
									<BrandMark logo={LINEAR_LOGO} className="inline-flex size-4" />
									{id} on Linear
								</MenuLinkItem>
							)}
							<MenuLinkItem href={hashForTickets(id)}>
								<TicketsIcon />
								{id} in Tickets
							</MenuLinkItem>
						</Fragment>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
