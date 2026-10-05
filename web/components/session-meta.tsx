import { ArrowUpRight } from "lucide-react";
import { Fragment } from "react";
import type { LinkedPullRequest } from "../../src/shared";
import { graphiteUrl, pullRequestUrl } from "../inbox-model";
import { projectName } from "../labels";
import { hashForInbox, hashForTickets } from "../routing";
import { OrgIcon } from "./org-icon";

/** The project a session runs in, with its full directory on hover. */
export const Project = ({ cwdDisplay }: { cwdDisplay: string }) => <span title={cwdDisplay}>{projectName(cwdDisplay) ?? cwdDisplay}</span>;

/**
 * The PRs a session submitted or worked on, after a separator. The number opens the PR's details in the inbox, the
 * arrow after it opens the PR on GitHub, and the Graphite mark opens it on Graphite.
 */
export function PullRequests({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
	return pullRequests.map(pr => {
		const name = `${pr.owner}/${pr.repo}#${pr.number}`;
		return (
			<Fragment key={name}>
				{" · "}
				<a
					href={hashForInbox(pr)}
					title={`${name}, which this session ${pr.link === "submitted" ? "submitted" : "worked on"}, in the inbox`}
					className="underline-offset-2 hover:text-foreground hover:underline"
				>
					#{pr.number}
				</a>
				<a
					href={pullRequestUrl(pr)}
					target="_blank"
					rel="noreferrer"
					title={`${name} on GitHub`}
					aria-label={`${name} on GitHub`}
					className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ArrowUpRight aria-hidden className="inline size-3 align-[-0.125em]" />
				</a>
				<a
					href={graphiteUrl(pr)}
					target="_blank"
					rel="noreferrer"
					title={`${name} on Graphite`}
					aria-label={`${name} on Graphite`}
					className="ml-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<OrgIcon org="graphite" className="inline align-[-0.125em]" />
				</a>
			</Fragment>
		);
	});
}

/** The Linear issues a session worked on, after a separator; each opens the issue's sheet on the tickets page. */
export function Tickets({ tickets }: { tickets: string[] }) {
	return tickets.map(id => (
		<Fragment key={id}>
			{" · "}
			<a href={hashForTickets(id)} title={`${id}, which this session worked on, in the tickets page`} className="underline-offset-2 hover:text-foreground hover:underline">
				{id}
			</a>
		</Fragment>
	));
}
