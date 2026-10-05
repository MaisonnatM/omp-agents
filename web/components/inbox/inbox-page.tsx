import type { ReactNode } from "react";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { type Inbox, type InboxPullRequest, type PastSession, type PullRequest, pullRequestUrl, type RepoInbox, type RosterHost, repoKey, samePullRequest, type WorkItem } from "../../../src/shared";
import { projectName } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { actionOn, pendingOf, pullRequestStart } from "../../quick-actions";
import { foldedByDefault, inboxSection, inboxSections, sectionFoldKey, shownPullRequests } from "../../inbox-model";
import { inboxStore } from "../../reads";
import { hashForInbox } from "../../routing";
import { sessionsOn } from "../../sessions";
import type { SectionTarget } from "../../section";
import { useShortcuts } from "../../shortcuts";
import { useDashboardContext } from "../dashboard-context";
import { FoldButton, type Folds, useFolds, useReveal } from "../fold";
import { ListSheetPage, TargetSheet } from "../list-sheet-page";
import { QuickStartNotice } from "../quick-actions";
import { PullRequestSheetContent } from "./pr-details";
import { PullRequestRow, rowId, sessionsFor } from "./pr-row";

/** The repositories and sections flipped from their default fold: `owner/repo`, and `owner/repo:<section title>`. */
const FOLDS_KEY = "omp-agents.inbox-collapsed";

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	target: PullRequest | null;
	folds: Folds;
}

function RepoSection({ inbox, hosts, past, target, folds }: RepoProps) {
	const { open: onOpen, start, starts: { quick } } = useDashboardContext();
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = repoKey(inbox);
	const headingId = `inbox-${name}`;
	const bodyId = `${headingId}-body`;
	const open = !folds.isFolded(key);
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
			const sectionKey = sectionFoldKey(key, section.title);
			const sectionOpen = !folds.isFolded(sectionKey);
			const { id } = inboxSection(key, section.title);
			const listId = `${id}-list`;
			return (
				// Focused when its sidebar link is chosen.
				<div key={section.title} id={id} tabIndex={-1} className="scroll-mt-6 space-y-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<h4 className="text-xs font-medium text-muted-foreground">
						<FoldButton open={sectionOpen} onToggle={() => folds.toggle(sectionKey)} controls={listId}>
							{section.title}
							<span className="tabular-nums">{section.rows.length}</span>
						</FoldButton>
					</h4>
					{sectionOpen && (
						<ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{section.rows.map(row => (
								<PullRequestRow
									key={row.pr.number}
									row={row}
									sessions={sessionsFor(row.pr, hosts, past)}
									targeted={target !== null && samePullRequest(row.pr, target)}
									onOpen={onOpen}
									pending={pendingOf(quick, { kind: "pull-request", pr: row.pr })}
									onQuickAction={(action: PullRequestActionId) => start(pullRequestStart(row.pr, action, inbox.cwds[0]!, readPinnedSkill()))}
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
				<FoldButton open={open} onToggle={() => folds.toggle(key)} controls={bodyId}>
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
		const section = inboxSections(repo.pullRequests).find(({ rows }) => rows.some(row => samePullRequest(row.pr, pr)));
		const key = repoKey(repo);
		if (section) return { repo: key, section: sectionFoldKey(key, section.title) };
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

/**
 * J and K move between the rows `shown` lists, or, while a sheet is open, show the next or previous pull request in it.
 * O opens the pull request on GitHub, and `.` opens a row's quick actions. A key that has nothing to act on keeps its
 * usual meaning.
 */
function useTriageKeys(shown: InboxPullRequest[], target: PullRequest | null): void {
	const rowOf = (pr: PullRequest): HTMLElement | null => document.getElementById(rowId(pr));
	const current = (): number =>
		target ? shown.findIndex(pr => samePullRequest(pr, target)) : shown.findIndex(pr => rowOf(pr)?.contains(document.activeElement) ?? false);
	const step = (by: 1 | -1): boolean => {
		const at = current();
		if (target) {
			if (at < 0) return false;
			const next = shown[at + by];
			if (next) location.hash = hashForInbox(next);
			return true;
		}
		const next = at < 0 ? shown[by === 1 ? 0 : shown.length - 1] : shown[at + by];
		const row = next && rowOf(next);
		if (!row) return at >= 0;
		row.querySelector("a")?.focus({ preventScroll: true });
		row.scrollIntoView({ block: "nearest" });
		return true;
	};
	useShortcuts({
		nextPullRequest: () => step(1),
		previousPullRequest: () => step(-1),
		pullRequestOnGitHub: () => {
			const pr = target ?? shown[current()];
			if (!pr) return false;
			window.open(pullRequestUrl(pr), "_blank", "noopener,noreferrer");
		},
		pullRequestActions: () => {
			const pr = target ? undefined : shown[current()];
			const trigger = pr && rowOf(pr)?.querySelector<HTMLButtonElement>("[data-row-actions] button");
			if (!trigger) return false;
			trigger.click();
		},
	});
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
	const poll = inboxStore.use(project);
	const { read } = poll;
	const folds = useFolds(FOLDS_KEY, foldedByDefault);
	const place = read && target ? placeOf(read.data, target) : null;
	const row = target && place ? { id: rowId(target), folds: [place.repo, place.section] } : null;
	useReveal(row, folds, { token: row?.id, block: "center", focus: false });
	useReveal(section, folds, { token: section, block: "start", focus: true });
	useTriageKeys(read ? shownPullRequests(read.data, folds.isFolded) : [], target);

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
								quick={{
									actions: listed ? pullRequestActions(listed.pr) : [],
									pending: pendingOf(quick, item),
									onRun: (action: PullRequestActionId) => listed && start(pullRequestStart(listed.pr, action, listed.cwd, readPinnedSkill())),
								}}
								sessions={sessionsOn(item, hosts)}
								onOpen={open}
								notice={quick && actionOn(quick.op.subject, item) !== null && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
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
						<RepoSection key={`${repo.owner}/${repo.repo}`} inbox={repo} hosts={hosts} past={past} target={target} folds={folds} />
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
