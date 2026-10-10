/** The inbox page: every pull request in a table, by repository, in a card per section named after whose move it is. */
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import type { SectionTarget } from "../../section";
import { DROP_LINE } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { FoldButton, useReveal } from "../fold";
import { ListPage } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { pullRequestSectionTarget, type RepoView, type SectionView, SortMenu, UnmatchedTip, usePullRequestBoard, workspacesLabel } from "./list-board";
import { SectionCount } from "./list-nav";
import { PullRequestTableRow } from "./pr-row";

const note = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>;

function SectionCard({ repo, view }: { repo: string; view: SectionView }) {
	const { section, listId, open, toggle, drag, moveId, rows } = view;
	const { id } = pullRequestSectionTarget(repo, section.title);
	return (
		<section
			id={id}
			// Focused when its sidebar link is chosen.
			tabIndex={-1}
			aria-labelledby={`${id}-heading`}
			{...drag.target}
			data-move={moveId}
			className={cn(
				"relative scroll-mt-6 rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring",
				drag.dragging && "opacity-50",
				drag.dropAt && DROP_LINE[drag.dropAt],
			)}
		>
			<h3 id={`${id}-heading`} {...drag.handle} className="flex items-center gap-2 rounded-t-md bg-muted/50 px-3 py-1.5 text-sm font-medium">
				<FoldButton open={open} onToggle={toggle} controls={listId} className="items-center">
					{section.title}
				</FoldButton>
				<SectionCount section={view} className="text-xs text-muted-foreground" />
			</h3>
			{open && (
				<ul id={listId} aria-label={section.title} className="divide-y divide-border border-t border-border">
					{rows.map(row => (
						<PullRequestTableRow key={row.row.pr.number} {...row} />
					))}
				</ul>
			)}
		</section>
	);
}

function RepoTable({ view }: { view: RepoView }) {
	const { repo, key, name, bodyId, open, toggle, drag, moveId, sections } = view;
	const workspaces = workspacesLabel(repo);
	return (
		<section aria-label={name} {...drag.target} data-move={moveId} className={cn("@container/inbox relative space-y-3", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}>
			<h2 {...drag.handle} className="flex items-baseline gap-2 text-sm" style={{ fontVariationSettings: fontWeights.semibold }}>
				<FoldButton open={open} onToggle={toggle} controls={bodyId}>
					<span className="truncate" title={repo.cwds.join("\n")}>
						{name}
					</span>
					{workspaces && (
						<span className="truncate text-xs text-muted-foreground" style={{ fontVariationSettings: fontWeights.normal }}>
							{workspaces}
						</span>
					)}
				</FoldButton>
			</h2>
			{open && (
				<div id={bodyId} className="space-y-3">
					{"error" in repo ? (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							Cannot read {name} from GitHub: {repo.error}
						</p>
					) : sections.length === 0 ? (
						note("No open pull requests of yours and no reviews waiting on you.")
					) : (
						sections.map(section => <SectionCard key={section.section.title} repo={key} view={section} />)
					)}
				</div>
			)}
		</section>
	);
}

interface PullRequestsPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
}

/**
 * The inbox in the main area, as a table: the pull requests of the sidebar's project, or of every project, read from
 * GitHub. It keeps the sidebar list's order, folds, and keys.
 */
export function PullRequestsPage({ project, hosts, past, section }: PullRequestsPageProps) {
	const { dismissStart } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const board = usePullRequestBoard({ project, hosts, past, route: { target: null } });
	useReveal(section, board.folds, { token: section, block: "start", focus: true });
	const unmatched = board.poll.read?.data.unmatched ?? [];
	return (
		<ListPage
			title="Inbox"
			meta="Pull requests by whose move it is"
			noun="the inbox"
			loading="Asking GitHub for pull requests…"
			poll={board.poll}
			onRefresh={board.refresh}
			actions={
				<>
					<UnmatchedTip unmatched={unmatched} />
					<SortMenu order={board.order} onSort={board.onSort} onReset={board.onReset} />
				</>
			}
			notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
			className="max-w-7xl space-y-8"
		>
			{() => (board.repos.length === 0 ? note("No session ran in a GitHub repository.") : board.repos.map(view => <RepoTable key={view.key} view={view} />))}
		</ListPage>
	);
}
