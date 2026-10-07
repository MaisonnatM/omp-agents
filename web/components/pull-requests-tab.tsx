import { GitPullRequest } from "lucide-react";
import { useState } from "react";
import { type LinkedPullRequest, prKey } from "../../src/shared/github";
import type { RosterHost } from "../../src/shared/sessions";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { LINK_VERB } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { hashForInbox } from "../routing";
import { PullRequestDetails } from "./inbox/pr-page";

interface PullRequestsTabProps {
	/** What the session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The sidebar's project `cwd`, or `null` for every project, whose inbox offers the quick actions. */
	project: string | null;
	hosts: RosterHost[];
	/** A change reads the shown pull request from GitHub again. */
	version?: unknown;
}

/**
 * The session's pull requests in the right sidebar: a list to pick one when it has several, a link to its details in
 * the inbox, and its details as the inbox page shows them. The first one shows until another is picked.
 */
export function PullRequestsTab({ pullRequests, project, hosts, version }: PullRequestsTabProps) {
	const [picked, setPicked] = useState<string | null>(null);
	const shown = pullRequests.find(pr => prKey(pr) === picked) ?? pullRequests[0];
	if (!shown) return <p className="px-4 py-2 text-sm text-muted-foreground">No pull request yet.</p>;
	return (
		<>
			{pullRequests.length > 1 && (
				<SidebarGroup>
					<SidebarMenu aria-label="Pull requests">
						{pullRequests.map(pr => (
							<SidebarMenuItem key={prKey(pr)}>
								<SidebarMenuButton icon={GitPullRequest} isActive={pr === shown} aria-pressed={pr === shown} onClick={() => setPicked(prKey(pr))}>
									<span className="min-w-0 flex-1 truncate tabular-nums">
										{pr.repo} #{pr.number}
									</span>
									<span className="text-xs text-muted-foreground">{LINK_VERB[pr.link]}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			)}
			<SidebarGroup>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild icon={PAGE_ICON.inbox}>
							<a href={hashForInbox(shown)}>Open #{shown.number} in the inbox</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<div className="space-y-3 px-4 pt-1 pb-4">
				<PullRequestDetails project={project} hosts={hosts} target={shown} placement="sidebar" version={version} />
			</div>
		</>
	);
}
