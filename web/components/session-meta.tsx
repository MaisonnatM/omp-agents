/** The subagent header's crumb styles, and the menus of a session's pull requests and Linear issues. */
import { ChevronDown, GitPullRequest } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { type LinkedPullRequest, pullRequestUrl } from "../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { graphiteUrl } from "../pull-requests-model";
import { PAGE_ICON } from "../page-icons";
import { ticketsStore } from "../reads";
import { hashForPullRequests, hashForTickets } from "../routing";
import { linearUrlOf } from "../tickets-model";
import { BrandMark, LINEAR_LOGO } from "./integrations/brand-logos";
import { OrgIcon } from "./org-icon";

export const PARENT_CRUMB = "font-normal text-muted-foreground";
export const CRUMB_SEPARATOR = "px-1.5 font-normal text-muted-foreground/60";
const PullRequestsIcon = PAGE_ICON["pull-requests"];
const TicketsIcon = PAGE_ICON.tickets;
const NO_TICKETS: never[] = [];

/** The PRs a session submitted or worked on, behind one button: each opens on GitHub, on Graphite, or in its details on the Pull requests page. */
export function PullRequestMenu({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
	const [open, setOpen] = useState(false);
	const [first] = pullRequests;
	if (!first) return null;
	const more = pullRequests.length - 1;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip
				content={more > 0 ? `This session's ${pullRequests.length} pull requests` : `${first.owner}/${first.repo}#${first.number}`}
				forceOpen={open ? false : undefined}
				side="bottom"
			>
				<DropdownMenuTrigger render={<Button variant="secondary" size="compact" leadingIcon={GitPullRequest} trailingIcon={ChevronDown} active={open} />}>
					#{first.number}
					{more > 0 && <span className="text-muted-foreground">+{more}</span>}
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				{pullRequests.map((pr, index) => (
					<Fragment key={pullRequestUrl(pr)}>
						{index > 0 && <MenuSeparator />}
						<MenuLinkItem href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
							<OrgIcon org="github" className="size-4" />#{pr.number} on GitHub
						</MenuLinkItem>
						<MenuLinkItem href={graphiteUrl(pr)} target="_blank" rel="noreferrer">
							<OrgIcon org="graphite" className="size-4" />#{pr.number} on Graphite
						</MenuLinkItem>
						<MenuLinkItem href={hashForPullRequests(pr)}>
							<PullRequestsIcon />#{pr.number} in Pull requests
						</MenuLinkItem>
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The Linear issues a session worked on, behind one button: each opens on Linear, when the assigned issues name its
 * workspace, or on the Tickets page.
 */
export function TicketMenu({ tickets }: { tickets: string[] }) {
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
