import type { ReactNode } from "react";
import { type Inbox, type InboxPullRequest, type PastSession, type PullRequest, type RepoInbox, type RosterHost, repoKey, samePullRequest, type WorkItem } from "../../../src/shared";
import { projectName } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { actionOn, pendingOf, type PullRequestActionId, pullRequestActions, pullRequestStart } from "../../quick-actions";
import { inboxSection, inboxSections } from "../../inbox-model";
import { inboxStore } from "../../reads";
import { hashForInbox } from "../../routing";
import { sessionsOn } from "../../sessions";
import type { SectionTarget } from "../../section";
import { useStoredKeys } from "../../stored-state";
import { useDashboardContext } from "../dashboard-context";
import { FoldButton, useReveal } from "../fold";
import { ListSheetPage, TargetSheet } from "../list-sheet-page";
import { QuickStartNotice, SheetQuickActions } from "../quick-actions";
import { PullRequestSheetContent } from "./pr-details";
import { PullRequestRow, rowId, sessionsFor } from "./pr-row";

/** Folded repositories and sections: `owner/repo`, and `owner/repo:<section title>`. */
const COLLAPSED_KEY = "omp-agents.inbox-collapsed";

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	target: PullRequest | null;
	collapsed: ReadonlySet<string>;
	onToggle: (key: string) => void;
}

function RepoSection({ inbox, hosts, past, target, collapsed, onToggle }: RepoProps) {
	const { open: onOpen, start, starts: { quick } } = useDashboardContext();
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = repoKey(inbox);
	const headingId = `inbox-${name}`;
	const bodyId = `${headingId}-body`;
	const open = !collapsed.has(key);
	const sections = "error" in inbox ? [] : inboxSections(inbox.pullRequests);
	let body: ReactNode;
	if ("error" in inbox) {
		body = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot read {name} from GitHub: {inbox.error}
			</p>
		);
	} else if (sections.length === 0) {
		body = <p className="text-sm text-muted-foreground">No open pull requests of yours and no reviews waiting on you.</p>;
	} else {
		body = sections.map(section => {
			const sectionKey = `${key}:${section.title}`;
			const sectionOpen = !collapsed.has(sectionKey);
			const { id } = inboxSection(key, section.title);
			const listId = `${id}-list`;
			return (
				// Focused when its sidebar link is chosen.
				<div key={section.title} id={id} tabIndex={-1} className="scroll-mt-6 space-y-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<h4 className="text-xs font-medium text-muted-foreground">
						<FoldButton open={sectionOpen} onToggle={() => onToggle(sectionKey)} controls={listId}>
							{section.title}
							<span className="tabular-nums">{section.pullRequests.length}</span>
						</FoldButton>
					</h4>
					{sectionOpen && (
						<ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{section.pullRequests.map(pr => (
								<PullRequestRow
									key={pr.number}
									pr={pr}
									sessions={sessionsFor(pr, hosts, past)}
									targeted={target !== null && samePullRequest(pr, target)}
									onOpen={onOpen}
									pending={pendingOf(quick, { kind: "pull-request", pr })}
									onQuickAction={(action: PullRequestActionId) => start(pullRequestStart(pr, action, inbox.cwds[0]!, readPinnedSkill()))}
								/>
							))}
						</ul>
					)}
				</div>
			);
		});
	}
	return (
		<section aria-labelledby={headingId} className="space-y-4">
			<h3 id={headingId} className="text-sm font-semibold">
				<FoldButton open={open} onToggle={() => onToggle(key)} controls={bodyId}>
					{name}
					<span className="truncate text-xs font-normal text-muted-foreground" title={inbox.cwds.join("\n")}>
						{inbox.cwds.length === 1 ? projectName(inbox.cwds[0]!) : `${inbox.cwds.length} workspaces`}
					</span>
				</FoldButton>
			</h3>
			{open && (
				<div id={bodyId} className="space-y-4">
					{body}
				</div>
			)}
		</section>
	);
}

/** The fold keys of the repository and the section that list `pr`, or `null` when the inbox does not list it. */
function placeOf(inbox: Inbox, pr: PullRequest): { repo: string; section: string } | null {
	for (const repo of inbox.repos) {
		if ("error" in repo) continue;
		const section = inboxSections(repo.pullRequests).find(({ pullRequests }) => pullRequests.some(other => samePullRequest(other, pr)));
		const key = repoKey(repo);
		if (section) return { repo: key, section: `${key}:${section.title}` };
	}
	return null;
}

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

interface InboxPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The PR an inbox link named: its row unfolds, scrolls into view, and stays highlighted while its details show in a sheet. */
	target: PullRequest | null;
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
}

/** The pull requests of the sidebar's project, or of every project, in Graphite's inbox sections, read from GitHub. */
export function InboxPage({ project, hosts, past, target, section }: InboxPageProps) {
	const { open, start, dismissStart, starts: { quick } } = useDashboardContext();
	const poll = inboxStore.usePolling(project);
	const { read } = poll;
	const [collapsed, toggleCollapsed, expand] = useStoredKeys(COLLAPSED_KEY);
	const place = read && target ? placeOf(read.data, target) : null;
	const row = target && place ? { id: rowId(target), folds: [place.repo, place.section] } : null;
	useReveal(row, collapsed, expand, { token: row?.id, block: "center", focus: false });
	useReveal(section, collapsed, expand, { token: section, block: "start", focus: true });

	return (
		<ListSheetPage
			title="Inbox"
			meta="Your pull requests and review requests on GitHub"
			noun="the inbox"
			loading="Asking GitHub for pull requests…"
			poll={poll}
			onRefresh={() => void inboxStore.refresh(project, { fresh: true })}
			missing={read && target && !place ? whyMissing(target, read.data, project === null) : null}
			notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
			spacing="space-y-10"
			sheet={
				<TargetSheet target={target} onClose={() => (location.hash = hashForInbox(null))}>
					{pr => {
						const listed = read && listedPullRequest(read.data, pr);
						const item: WorkItem = { kind: "pull-request", pr };
						return (
							<PullRequestSheetContent
								key={rowId(pr)}
								pr={pr}
								actions={
									listed && (
										<>
											<SheetQuickActions
												actions={pullRequestActions(listed.pr)}
												pending={pendingOf(quick, item)}
												onRun={(action: PullRequestActionId) => start(pullRequestStart(listed.pr, action, listed.cwd, readPinnedSkill()))}
												sessions={sessionsOn(item, hosts)}
												onOpen={open}
											/>
											{quick && actionOn(quick.op.subject, item) !== null && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
										</>
									)
								}
							/>
						);
					}}
				</TargetSheet>
			}
		>
			{({ repos, unmatched }) => (
				<>
					{repos.length === 0 && <p className="text-sm text-muted-foreground">No session ran in a GitHub repository.</p>}
					{repos.map(repo => (
						<RepoSection
							key={`${repo.owner}/${repo.repo}`}
							inbox={repo}
							hosts={hosts}
							past={past}
							target={target}
							collapsed={collapsed}
							onToggle={toggleCollapsed}
						/>
					))}
					{unmatched.length > 0 && (
						<p className="text-xs text-muted-foreground" title={unmatched.join("\n")}>
							{unmatched.length === 1 ? "1 workspace has" : `${unmatched.length} workspaces have`} no GitHub origin and is left out.
						</p>
					)}
				</>
			)}
		</ListSheetPage>
	);
}
