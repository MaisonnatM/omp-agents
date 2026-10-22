import { ClipboardList, FileDiff, GitPullRequest, Images } from "lucide-react";
import type { LinkedPullRequest } from "../../src/shared/github";
import { latestReviewTriage } from "../../src/shared/review-triage";
import type { RosterHost, View } from "../../src/shared/sessions";
import { PAGE_ICON } from "../page-icons";
import { useChangedFiles, useMedia } from "../pane-store";
import { DetailsSidebarFrame } from "./details-sidebar-frame";
import { FilesTab } from "./files-tab";
import { MediaTab } from "./media-tab";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";
import { useDashboardStatus } from "./dashboard-context";
import { SessionReviewTriage } from "./review-triage";

/** The right sidebar's tab, which localStorage keeps across views. The key keeps its old name, and a tab that no longer exists reads as Files. */
const TAB_KEY = "omp-agents.plan-tab";

interface SessionDetailsProps {
	view: View;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** The session whose changes the Files tab opens; `null` for a subagent's view and for a live session not yet in the roster. */
	sessionId: string | null;
	/** The session's directory, which relative paths in the Files tab resolve against. */
	cwd: string | null;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first. */
	tickets: string[];
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
}

/**
 * The right sidebar's content for the focused view: the files its agent changed,
 * the images its agents' tools returned, its session's pull requests, and its Linear issues when it has any, each tab apart.
 */
export function SessionDetails({ view, working, sessionId, cwd, pullRequests, tickets, workspace, hosts }: SessionDetailsProps) {
	const files = useChangedFiles(view);
	const media = useMedia(view);
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(host => host.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const latest = latestReviewTriage(useDashboardStatus().reviewTriages.list.filter(triage => triage.target.kind === "local-session" && triage.target.sessionId === sessionId));
	const undecided = latest && !latest.batch ? latest.items.filter(item => item.decision === "pending").length : 0;
	return (
		<DetailsSidebarFrame
			label="Session details"
			storageKey={TAB_KEY}
			defaultTab="files"
			cwd={cwd}
			tabs={[
				{ value: "files", icon: FileDiff, name: "Files", count: files?.length ?? 0, pinned: true, content: <FilesTab files={files} sessionId={sessionId} cwd={cwd} working={working} /> },
				{ value: "media", icon: Images, name: "Media", count: media?.length ?? 0, content: <MediaTab media={media} view={view} pullRequests={pullRequests} tickets={tickets} /> },
				{
					value: "pull-requests",
					icon: GitPullRequest,
					name: "PRs",
					count: pullRequests.length,
					scrollsItself: true,
					content: <SessionPullRequestsTab pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} current={view.kind === "live" ? view.instanceId : null} scope={`session:${scope}`} />,
				},
				...(sessionId ? [{ value: "triage", icon: ClipboardList, name: "Review triage", count: undecided, content: <SessionReviewTriage sessionId={sessionId} /> } as const] : []),
				...(tickets.length > 0
					? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", count: tickets.length, content: <SessionTicketsTab tickets={tickets} version={working} /> } as const]
					: []),
			]}
		/>
	);
}
