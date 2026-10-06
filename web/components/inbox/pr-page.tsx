import { ArrowLeft } from "lucide-react";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { type Inbox, type InboxPullRequest, type PullRequest, type RosterHost, repoKey, samePullRequest, type WorkItem } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readPinnedSkill } from "../../pinned-skill";
import { actionOn, pendingOf, pullRequestStart } from "../../quick-actions";
import { inboxStore } from "../../reads";
import { hashForInbox } from "../../routing";
import { sessionsOn } from "../../sessions";
import { useDashboardContext } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { PullRequestDetailContent } from "./pr-details";
import { rowId } from "./pr-row";

/** The pull request as the inbox lists it, with the workspace a session on it starts in; `null` when the inbox does not list it. */
function listedPullRequest(inbox: Inbox, pr: PullRequest): { pr: InboxPullRequest; cwd: string } | null {
	for (const repo of inbox.repos) {
		if ("error" in repo) continue;
		const listed = repo.pullRequests.find(other => samePullRequest(other, pr));
		if (listed && repo.cwds[0] !== undefined) return { pr: listed, cwd: repo.cwds[0] };
	}
	return null;
}

/** Why the inbox does not list the PR a link named. `allProjects`: the sidebar shows every project. */
function whyMissing(target: PullRequest, inbox: Inbox, allProjects: boolean): string {
	const repo = `${target.owner}/${target.repo}`;
	const covered = inbox.repos.some(other => repoKey(other) === repoKey(target));
	if (covered) {
		return `${repo}#${target.number} is not in this inbox. The inbox lists your open pull requests, your merges from the last seven days, and the pull requests that wait for your review.`;
	}
	if (allProjects) return `${repo}#${target.number} is not in this inbox, because no session ran in ${repo}.`;
	return `${repo}#${target.number} is not in this inbox, which covers only the project that the sidebar shows. Choose All projects in the sidebar to include ${repo}.`;
}

interface PullRequestPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	target: PullRequest;
}

/** A pull request from the inbox in the main area, with the quick actions that start a session on it. */
export function PullRequestPage({ project, hosts, target }: PullRequestPageProps) {
	const { open, start, dismissStart, starts: { quick } } = useDashboardContext();
	const { read } = inboxStore.use(project);
	const listed = read && listedPullRequest(read.data, target);
	const item: WorkItem = { kind: "pull-request", pr: target };
	return (
		<PageFrame title="Inbox" meta="Your pull requests and review requests on GitHub">
			<TooltipProvider>
				<div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
					<Button variant="ghost" leadingIcon={ArrowLeft} render={<a href={hashForInbox(null)} />}>
						Back to the sessions
					</Button>
					{read && !listed && (
						<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
							{whyMissing(target, read.data, project === null)}
						</p>
					)}
					{quick && actionOn(quick.op.subject, item) !== null && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
					<PullRequestDetailContent
						key={rowId(target)}
						pr={target}
						quick={{
							actions: listed ? pullRequestActions(listed.pr) : [],
							pending: pendingOf(quick, item),
							onRun: (action: PullRequestActionId) => listed && start(pullRequestStart(listed.pr, action, listed.cwd, readPinnedSkill())),
						}}
						sessions={sessionsOn(item, hosts)}
						onOpen={open}
					/>
				</div>
			</TooltipProvider>
		</PageFrame>
	);
}
