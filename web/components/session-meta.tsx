/** The subagent header's crumb styles, and a session header's controls: its branch, its Linear issues, and its pull requests. */
import { Check, ChevronDown, Copy, GitPullRequest, Layers } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { type LinkedPullRequest, prKey, type StackedPullRequest } from "../../src/shared/github";
import type { SessionFacts } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { sessionStack } from "../pull-requests-model";
import { PAGE_ICON } from "../page-icons";
import { ticketsStore, useRead } from "../reads";
import { hashForTickets } from "../routing";
import { linearUrlOf } from "../tickets-model";
import { BrandMark, LINEAR_LOGO } from "./integrations/brand-logos";
import { BranchName, releaseBranch } from "./git";
import { StackPopover } from "./pull-requests/pr-details/stack";
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
	const [first] = pullRequests;
	const query = first && pullRequests.length > 1 ? new URLSearchParams({ owner: first.owner, repo: first.repo, number: String(first.number) }) : null;
	// Read again when the session links another PR, which may join the stack.
	const stackRead = useRead<StackedPullRequest[]>(query && `/api/pull-request/stack?${query}`, pullRequests.map(prKey).join());
	if (!first) return null;
	const stacked = sessionStack(pullRequests, stackRead.data ?? []);
	const others = stacked?.others ?? pullRequests;
	return (
		<StackPopover
			stack={stacked?.stack ?? []}
			others={others}
			align="end"
			trigger={open => (
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
			)}
		/>
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
