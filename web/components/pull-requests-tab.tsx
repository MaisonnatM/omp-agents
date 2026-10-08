import { GitPullRequest } from "lucide-react";
import { useState } from "react";
import { type LinkedPullRequest, type PullRequest, prKey, samePullRequest } from "../../src/shared/github";
import type { RosterHost } from "../../src/shared/sessions";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { pullRequestStack } from "../inbox-model";
import { LINK_VERB } from "../labels";
import { inboxStore } from "../reads";
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
 * The session's pull requests in the right sidebar: one's details as the inbox page shows them, the first until another
 * is picked from its stack, or from a list of the session's pull requests that the stack does not show.
 */
export function PullRequestsTab({ pullRequests, project, hosts, version }: PullRequestsTabProps) {
	const [picked, setPicked] = useState<PullRequest | null>(null);
	const { read } = inboxStore.use(project);
	const shown = picked ?? pullRequests[0];
	if (!shown) return <p className="px-4 py-2 text-sm text-muted-foreground">No pull request yet.</p>;
	const stack = read ? pullRequestStack(read.data, shown) : [];
	const unstacked = pullRequests.filter(pr => !stack.some(other => samePullRequest(other, pr)));
	return (
		<>
			{unstacked.some(pr => !samePullRequest(pr, shown)) && (
				<SidebarGroup className="pt-2">
					<SidebarMenu aria-label="Pull requests">
						{unstacked.map(pr => {
							const here = samePullRequest(pr, shown);
							return (
								<SidebarMenuItem key={prKey(pr)}>
									<SidebarMenuButton icon={GitPullRequest} isActive={here} aria-pressed={here} onClick={() => setPicked(pr)}>
										<span className="min-w-0 flex-1 truncate tabular-nums">
											{pr.repo} #{pr.number}
										</span>
										<span className="text-xs text-muted-foreground">{LINK_VERB[pr.link]}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroup>
			)}
			<div className="space-y-3 px-4 pt-2 pb-4">
				<PullRequestDetails project={project} hosts={hosts} target={shown} placement="sidebar" version={version} onPick={setPicked} />
			</div>
		</>
	);
}
