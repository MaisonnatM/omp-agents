import { ArrowUpRight } from "lucide-react";
import { Fragment } from "react";
import { type LinkedPullRequest, pullRequestUrl } from "../../src/shared/github";
import { Tooltip } from "@/components/ui/tooltip";
import { graphiteUrl } from "../inbox-model";
import { projectName } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { hashForInbox, hashForTickets } from "../routing";
import { OrgIcon } from "./org-icon";

/** The project a session runs in, with its full directory, and the worktree it works in when another, on hover. */
export const Project = ({ cwdDisplay, worktree }: { cwdDisplay: string; worktree: string | null }) => (
	<Tooltip content={worktree ? `${cwdDisplay}, working in ${worktree}` : cwdDisplay}>
		<span>{projectName(cwdDisplay) ?? cwdDisplay}</span>
	</Tooltip>
);

/**
 * The PRs a session submitted or worked on, after a separator. The inbox icon and number open the PR's details in the
 * inbox, the arrow after them opens the PR on GitHub, and the Graphite mark opens it on Graphite.
 */
export function PullRequests({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
	return pullRequests.map(pr => {
		const name = `${pr.owner}/${pr.repo}#${pr.number}`;
		return (
			<Fragment key={name}>
				{" · "}
				<Tooltip content={`${name}, which this session ${pr.link === "submitted" ? "submitted" : "worked on"}, in the inbox`}>
					<a
						href={hashForInbox(pr)}
						className="underline-offset-2 hover:text-foreground hover:underline"
					>
						<PAGE_ICON.inbox aria-hidden className="mr-0.5 inline size-3 align-[-0.125em]" />
						#{pr.number}
					</a>
				</Tooltip>
				<Tooltip content={`${name} on GitHub`}>
					<a
						href={pullRequestUrl(pr)}
						target="_blank"
						rel="noreferrer"
						aria-label={`${name} on GitHub`}
						className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						<ArrowUpRight aria-hidden className="inline size-3 align-[-0.125em]" />
					</a>
				</Tooltip>
				<Tooltip content={`${name} on Graphite`}>
					<a
						href={graphiteUrl(pr)}
						target="_blank"
						rel="noreferrer"
						aria-label={`${name} on Graphite`}
						className="ml-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						<OrgIcon org="graphite" className="inline align-[-0.125em]" />
					</a>
				</Tooltip>
			</Fragment>
		);
	});
}

/** The Linear issues a session worked on, after a separator; each opens the issue's sheet on the tickets page. */
export function Tickets({ tickets }: { tickets: string[] }) {
	return tickets.map(id => (
		<Fragment key={id}>
			{" · "}
			<Tooltip content={`${id}, which this session worked on, in the tickets page`}>
				<a href={hashForTickets(id)} className="underline-offset-2 hover:text-foreground hover:underline">
					<PAGE_ICON.tickets aria-hidden className="mr-0.5 inline size-3 align-[-0.125em]" />
					{id}
				</a>
			</Tooltip>
		</Fragment>
	));
}
