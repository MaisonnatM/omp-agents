/** `PullRequestDetailPage`: one pull request in the main area, with the quick actions that start a session on it. */
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { type PullRequestList, type LinkedPullRequest, type PullRequest, pullRequestUrl, repoKey } from "../../../src/shared/github";
import type { RosterHost, WorkItem } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useShortcuts } from "../../shortcuts";
import { useClipboard } from "../../use-copy";
import { listedPullRequest } from "../../pull-requests-model";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, pullRequestStart, quickOn } from "../../quick-actions";
import { pullRequestsStore } from "../../reads";
import { hashForPullRequestFiles, hashForPullRequests } from "../../routing";
import { sessionsOn } from "../../sessions";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { Header } from "../page-header";
import { QuickStartNotice } from "../quick-actions";
import { type Placement, PullRequestDetailContent, type PullRequestDetailTab } from "./pr-details";
import { rowId } from "./pr-row";

/** Why the pull request list does not hold the PR a link named. `allWorkspaces`: the sidebar shows every workspace. */
function whyMissing(target: PullRequest, list: PullRequestList, allWorkspaces: boolean): string {
	const repo = `${target.owner}/${target.repo}`;
	const covered = list.repos.some(other => repoKey(other) === repoKey(target));
	if (covered) {
		return `${repo}#${target.number} is not among these pull requests. The Pull requests page lists your open pull requests, your merges from the last seven days, and the pull requests that wait for your review.`;
	}
	if (allWorkspaces) return `${repo}#${target.number} is not among these pull requests, because no session ran in ${repo}.`;
	return `${repo}#${target.number} is not among these pull requests, which cover only the workspace that the sidebar shows. Choose All workspaces in the sidebar to include ${repo}.`;
}

interface PullRequestDetailsProps {
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
	target: PullRequest;
	placement: Placement;
	/** A change reads `target` from GitHub again. */
	version?: unknown;
	tab: PullRequestDetailTab;
	onTab: (tab: PullRequestDetailTab) => void;
	/** The changed file the route opens in the Code tab. */
	path?: string | null;
	/** Shows another pull request of its stack or of the session in place; without it, each of its stack links to its page. */
	onPick?: (pr: PullRequest) => void;
	/** The session's pull requests, in the session details sidebar. */
	session?: LinkedPullRequest[];
	/** The `instanceId` of the session whose sidebar shows it, which the details neither chip nor offer to open. */
	current?: string | null;
}

/**
 * `target`'s details with the quick actions that start a session on it, as the pull request list of `workspace` holds it, after what
 * became of a quick start on it. The page also says why the list does not hold it; the sidebar does not, since most
 * past sessions' merged pull requests would carry that note.
 */
export function PullRequestDetails({ workspace, hosts, target, placement, version, tab, onTab, path, onPick, session, current = null }: PullRequestDetailsProps) {
	const { open, start, dismissStart } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const { read } = pullRequestsStore.use(workspace);
	const listed = read && listedPullRequest(read.data, target);
	const item: WorkItem = { kind: "pull-request", pr: target };
	const sessions = sessionsOn(item, hosts).filter(host => host.instanceId !== current);
	const missing = placement === "page" && read && !listed;
	const started = quickOn(quick, item);
	return (
		<>
			{(missing || started) && (
				<div className={cn("space-y-2", placement === "page" ? "px-6 pt-4" : "px-4 pt-3")}>
					{missing && (
						<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
							{whyMissing(target, read.data, workspace === null)}
						</p>
					)}
					{started && <QuickStartNotice quick={started} onDismiss={() => dismissStart("quick")} />}
				</div>
			)}
			<PullRequestDetailContent
				key={rowId(target)}
				pr={target}
				listed={listed ? listed.pr : null}
				pending={pendingOf(quick, item)}
				onRun={(facts, action) => listed && start(pullRequestStart(facts, action, listed.cwd, readPinnedSkill()))}
				sessions={sessions}
				onOpen={open}
				session={session}
				placement={placement}
				version={version}
				tab={tab}
				onTab={onTab}
				path={path}
				onPick={onPick}
				workspace={workspace}
				cwd={listed?.cwd ?? hosts.find(host => host.instanceId === current)?.cwd ?? null}
			/>
		</>
	);
}

interface PullRequestDetailPageProps extends Pick<PullRequestDetailsProps, "workspace" | "hosts" | "target"> {
	/** The route's Code tab and the changed file it opens; `null` for another tab. */
	files: { path: string | null } | null;
}

/**
 * A pull request from the Pull requests page in the main area, with the quick actions that start a session on it.
 * Its host keys it by the pull request, so another one starts on **Summary**; the route alone says whether it shows **Code**.
 */
export function PullRequestDetailPage({ files, ...props }: PullRequestDetailPageProps) {
	const [kept, setKept] = useState<PullRequestDetailTab>("summary");
	const tab = files !== null ? "code" : kept;
	const choose = (next: PullRequestDetailTab): void => {
		if (next !== "code") setKept(next);
		if ((next === "code") !== (files !== null)) location.hash = next === "code" ? hashForPullRequestFiles(props.target) : hashForPullRequests(props.target);
	};
	const clipboard = useClipboard();
	useShortcuts({
		copyPullRequestNumber: () => clipboard.run(`#${props.target.number}`),
		copyPullRequestLink: () => clipboard.run(pullRequestUrl(props.target)),
	});
	const back = (
		<Tooltip content="Back to Pull requests" side="bottom">
			<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Back to Pull requests" render={<a href={hashForPullRequests(null)} />}>
				<ArrowLeft />
			</Button>
		</Tooltip>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<TooltipProvider>
				<Header title="Pull requests" meta="Your pull requests and review requests on GitHub" leading={back} />
				<div className="flex min-h-0 flex-1 flex-col">
					<PullRequestDetails {...props} placement="page" tab={tab} onTab={choose} path={files?.path ?? null} />
				</div>
			</TooltipProvider>
		</div>
	);
}
