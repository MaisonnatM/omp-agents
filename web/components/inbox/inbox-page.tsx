import { RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { Inbox, InboxPullRequest, PastSession, PullRequest, RepoInbox, RosterHost, View } from "../../../src/shared";
import { modeOf, projectName, readTime, SPLIT_CLICK } from "../../labels";
import { QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { inboxRepoKey, inboxSection, inboxSections, samePullRequest } from "../../inbox-model";
import { hashForInbox, type OpenMode } from "../../routing";
import type { SectionTarget } from "../../section";
import type { StartOf, StartOp } from "../../starts";
import { refreshInbox, useInbox } from "../../use-inbox";
import { Header } from "../conversation";
import { FoldButton, useCollapsed, useRevealSection } from "../fold";
import { PullRequestSheetContent } from "./pr-details";
import { PullRequestRow, rowId, sessionsFor } from "./pr-row";
import { QuickActionButtons } from "./quick-actions";

type QuickOp = Extract<StartOp, { kind: "quick" }>;

/** The action of the quick start under way for `pr`, if any. */
const pendingOf = (quick: StartOf<"quick"> | null, pr: PullRequest): QuickActionId | null =>
	quick?.phase === "starting" && samePullRequest(quick.op.pr, pr) ? quick.op.action : null;

interface NoticeProps {
	quick: StartOf<"quick">;
	onOpen: (view: View, mode: OpenMode) => void;
	onDismiss: () => void;
}

/** What became of the last quick action, with a button that forgets it: why its session did not start, or the session it started in the background, to open. */
function QuickStartNotice({ quick, onOpen, onDismiss }: NoticeProps) {
	if (quick.phase === "starting") return null;
	const { action, pr } = quick.op;
	const what = `"${QUICK_ACTIONS[action].label}" on ${pr.owner}/${pr.repo}#${pr.number}`;
	const failed = quick.phase === "failed";
	return (
		<p role={failed ? "alert" : "status"} className={cn("flex items-center gap-2 text-sm", failed ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
			<span className="min-w-0">{failed ? `Cannot start ${what}: ${quick.error}` : `Started ${what} in the background.`}</span>
			{quick.phase === "started" && (
				<Button
					variant="secondary"
					size="compact"
					className="shrink-0"
					title={`Open the session (${SPLIT_CLICK} to split)`}
					onClick={event => {
						onOpen(quick.view, modeOf(event));
						onDismiss();
					}}
				>
					Open session
				</Button>
			)}
			<Button variant="ghost" size="compact" className="shrink-0" onClick={onDismiss}>
				Dismiss
			</Button>
		</p>
	);
}

/** The start of `action` on `pr`, in `cwd`: the repository's most recently used workspace. */
const quickOp = (pr: InboxPullRequest, cwd: string, action: QuickActionId): QuickOp => ({
	kind: "quick",
	cwd,
	prompt: QUICK_ACTIONS[action].prompt(pr),
	pr: { owner: pr.owner, repo: pr.repo, number: pr.number },
	action,
});

/** Folded repositories and sections: `owner/repo`, and `owner/repo:<section title>`. */
const COLLAPSED_KEY = "omp-agents.inbox-collapsed";

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	target: PullRequest | null;
	collapsed: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (view: View, mode: OpenMode) => void;
	quick: StartOf<"quick"> | null;
	onQuickAction: (op: QuickOp) => void;
}

function RepoSection({ inbox, hosts, past, target, collapsed, onToggle, onOpen, quick, onQuickAction }: RepoProps) {
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = inboxRepoKey(inbox);
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
									pending={pendingOf(quick, pr)}
									onQuickAction={action => onQuickAction(quickOp(pr, inbox.cwds[0]!, action))}
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
		const key = `${repo.owner}/${repo.repo}`.toLowerCase();
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
function MissingTarget({ target, inbox, allProjects }: { target: PullRequest; inbox: Inbox; allProjects: boolean }) {
	const repo = `${target.owner}/${target.repo}`;
	const covered = inbox.repos.some(other => `${other.owner}/${other.repo}`.toLowerCase() === repo.toLowerCase());
	let reason = `${repo}#${target.number} is not in this inbox, which covers only the project that the sidebar shows. Choose All projects in the sidebar to include ${repo}.`;
	if (covered) {
		reason = `${repo}#${target.number} is not in this inbox. The inbox lists your open pull requests, your merges from the last seven days, and the pull requests that wait for your review.`;
	} else if (allProjects) {
		reason = `${repo}#${target.number} is not in this inbox, because no session ran in ${repo}.`;
	}
	return (
		<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
			{reason}
		</p>
	);
}

interface InboxPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The PR an inbox link named: its row unfolds, scrolls into view, and stays highlighted while its details show in a sheet. */
	target: PullRequest | null;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
	/** The quick action's start under way, failed, or started, whichever the page last asked for. */
	quick: StartOf<"quick"> | null;
	onQuickAction: (op: QuickOp) => void;
	onDismissQuick: () => void;
}

/** The pull requests of the sidebar's project, or of every project, in Graphite's inbox sections, read from GitHub. */
export function InboxPage({ project, hosts, past, target, onOpen, section, quick, onQuickAction, onDismissQuick }: InboxPageProps) {
	const { read, error, refreshing } = useInbox(project, true);
	const [collapsed, toggleCollapsed, expand] = useCollapsed(COLLAPSED_KEY);
	const place = read && target ? placeOf(read.data, target) : null;
	const targetKey = target && rowId(target);
	/** The target whose row the page already unfolded and scrolled to; folding it again afterwards stays folded. */
	const shown = useRef<string | null>(null);
	/** The PR the sheet shows, kept after the hash drops it so the sheet's content stays through its exit slide. */
	const sheetPr = useRef<PullRequest | null>(null);
	if (target) sheetPr.current = target;
	const sheetListed = read && sheetPr.current ? listedPullRequest(read.data, sheetPr.current) : null;

	useEffect(() => {
		if (!place || !targetKey || shown.current === targetKey) return;
		const folded = [place.repo, place.section].filter(key => collapsed.has(key));
		if (folded.length > 0) {
			// Unfolding renders the row; this effect runs again and then scrolls to it.
			expand(folded);
			return;
		}
		shown.current = targetKey;
		document.getElementById(targetKey)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [place?.repo, place?.section, targetKey, collapsed]);

	useRevealSection(section, collapsed, expand);

	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the inbox: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">Asking GitHub for pull requests…</p>;
	else {
		const { repos, unmatched } = read.data;
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the inbox: {error}</p>}
				{target && !place && <MissingTarget target={target} inbox={read.data} allProjects={project === null} />}
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
						onOpen={onOpen}
						quick={quick}
						onQuickAction={onQuickAction}
					/>
				))}
				{unmatched.length > 0 && (
					<p className="text-xs text-muted-foreground" title={unmatched.join("\n")}>
						{unmatched.length === 1 ? "1 workspace has" : `${unmatched.length} workspaces have`} no GitHub origin and is left out.
					</p>
				)}
			</>
		);
	}

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header
				title="Inbox"
				meta={read ? `Your pull requests and review requests on GitHub · updated ${readTime(read.at)}` : "Your pull requests and review requests on GitHub"}
			>
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={() => void refreshInbox(project, true)}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">
						{quick && <QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />}
						{body}
					</div>
					{sheetPr.current && (
						<Sheet open={target !== null} onClose={() => (location.hash = hashForInbox(null))}>
							<PullRequestSheetContent
								key={rowId(sheetPr.current)}
								pr={sheetPr.current}
								actions={
									sheetListed && (
										<>
											<QuickActionButtons
												pr={sheetListed.pr}
												pending={pendingOf(quick, sheetListed.pr)}
												onRun={action => onQuickAction(quickOp(sheetListed.pr, sheetListed.cwd, action))}
											/>
											{quick && samePullRequest(quick.op.pr, sheetListed.pr) && (
												<QuickStartNotice quick={quick} onOpen={onOpen} onDismiss={onDismissQuick} />
											)}
										</>
									)
								}
							/>
						</Sheet>
					)}
				</TooltipProvider>
			</div>
		</div>
	);
}
