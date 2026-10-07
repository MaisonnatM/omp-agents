import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { type Inbox, type InboxPullRequest, type PullRequest, repoKey } from "../../../src/shared/github";
import type { RosterHost, WorkItem } from "../../../src/shared/sessions";
import { agentOn, listedPullRequest, moveAction, moveOf, pullRequestStack, reason } from "../../inbox-model";
import { readPinnedSkill } from "../../pinned-skill";
import { actionOn, pendingOf, pullRequestStart } from "../../quick-actions";
import { inboxStore } from "../../reads";
import { hashForInbox } from "../../routing";
import { sessionsOn } from "../../sessions";
import { useDashboardContext } from "../dashboard-context";
import { DetailPage } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { type NextMove, type Placement, PullRequestDetailContent } from "./pr-details";
import { rowId } from "./pr-row";

/** What `pr` waits on next, given the running sessions `sessions` on it. */
function nextMove(pr: InboxPullRequest, hosts: RosterHost[], sessions: RosterHost[]): NextMove {
	const move = moveOf(pr, agentOn(hosts)(pr));
	const holder = move === "answer" ? "needs-input" : move === "agent" ? "working" : null;
	return { move, reason: reason(pr, move), action: moveAction(pr, move), session: sessions.find(host => host.status === holder) ?? null };
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

interface PullRequestDetailsProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	target: PullRequest;
	placement: Placement;
	/** A change reads `target` from GitHub again. */
	version?: unknown;
}

/**
 * `target`'s details with the quick actions that start a session on it, as the inbox of `project` lists it, after what
 * became of a quick start on it. The page also says why the inbox does not list it; the sidebar does not, since most
 * past sessions' merged pull requests would carry that note.
 */
export function PullRequestDetails({ project, hosts, target, placement, version }: PullRequestDetailsProps) {
	const { open, start, dismissStart, starts: { quick } } = useDashboardContext();
	const { read } = inboxStore.use(project);
	const listed = read && listedPullRequest(read.data, target);
	const item: WorkItem = { kind: "pull-request", pr: target };
	const sessions = sessionsOn(item, hosts);
	return (
		<>
			{placement === "page" && read && !listed && (
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
				sessions={sessions}
				onOpen={open}
				next={listed ? nextMove(listed.pr, hosts, sessions) : null}
				stack={read ? pullRequestStack(read.data, target) : []}
				placement={placement}
				version={version}
			/>
		</>
	);
}

/** A pull request from the inbox in the main area, with the quick actions that start a session on it. */
export function PullRequestPage(props: Omit<PullRequestDetailsProps, "placement" | "version">) {
	return (
		<DetailPage title="Inbox" meta="Your pull requests and review requests on GitHub" backHref={hashForInbox(null)} backLabel="Back to the inbox" className="max-w-7xl">
			<PullRequestDetails {...props} placement="page" />
		</DetailPage>
	);
}
