import { ChevronDown, GitPullRequest } from "lucide-react";
import { Fragment, useState } from "react";
import { type LinkedPullRequest, pullRequestUrl } from "../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { graphiteUrl } from "../pull-requests-model";
import { projectName } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { hashForPullRequests } from "../routing";
import { OrgIcon } from "./org-icon";

const PARENT_CRUMB = "font-normal text-muted-foreground";
const PullRequestsIcon = PAGE_ICON["pull-requests"];

/**
 * `webapp / Fix login`: the project a session runs in, then `path`, each name below the one before it. Hover the project
 * for its full directory, and the worktree it works in when another.
 */
export function SessionTrail({ cwdDisplay, worktree, path }: { cwdDisplay: string; worktree: string | null; path: string[] }) {
	return (
		<>
			<Tooltip content={worktree ? `${cwdDisplay}, working in ${worktree}` : cwdDisplay}>
				<span className={path.length > 0 ? PARENT_CRUMB : undefined}>{projectName(cwdDisplay) ?? cwdDisplay}</span>
			</Tooltip>
			{path.map((name, index) => (
				<Fragment key={index}>
					<span aria-hidden className="px-1.5 font-normal text-muted-foreground/60">
						/
					</span>
					<span className={index < path.length - 1 ? PARENT_CRUMB : undefined}>{name}</span>
				</Fragment>
			))}
		</>
	);
}

/** The PRs a session submitted or worked on, behind one button: each opens on GitHub, on Graphite, or in the inbox's details. */
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
