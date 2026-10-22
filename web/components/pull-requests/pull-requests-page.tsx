/**
 * The Pull requests page: every pull request in a table, by repository, in a card per section named after whose move it
 * is; or on a board, a column per section, with the details of the pull request it shows docked beside it.
 */
import { Maximize2, X } from "lucide-react";
import { useState } from "react";
import type { PullRequest } from "../../../src/shared/github";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { hashForPullRequests, type PullRequestsRoute } from "../../routing";
import type { SectionTarget } from "../../section";
import { DROP_LINE } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { DetailsScrollerContext } from "../details-sidebar-frame";
import { FoldButton, useReveal } from "../fold";
import { ListPage } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { pullRequestSectionTarget, type PullRequestsView, type RepoView, type SectionView, SortMenu, UnmatchedTip, usePullRequestsBoard, usePullRequestsView, workspacesLabel } from "./pull-requests-board";
import { PullRequestsKanban } from "./pull-requests-kanban";
import { SectionCount } from "./pull-requests-nav";
import { PullRequestDetails } from "./pr-page";
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
		<section aria-label={name} {...drag.target} data-move={moveId} className={cn("@container/pull-requests relative space-y-3", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}>
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
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: SectionTarget | null;
	/** The pull request whose details the board docks beside it; the list view shows them on a page of their own instead. */
	route: PullRequestsRoute;
}

/** The details of the pull request `route` names, docked beside the board, with buttons that show them as a page or close them. */
function DockedDetails({ workspace, hosts, route, onExpand }: { workspace: string | null; hosts: RosterHost[]; route: Extract<PullRequestsRoute, { target: PullRequest }>; onExpand: () => void }) {
	const [scroller, setScroller] = useState<HTMLElement | null>(null);
	return (
		<aside aria-label="Pull request details" className="flex w-[30rem] max-w-[45%] shrink-0 flex-col border-l border-border">
			<TooltipProvider>
				<div className="flex h-(--page-header-height) shrink-0 items-center justify-end gap-1 border-b border-border px-3">
					<Tooltip content="Open as a page" side="bottom">
						<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Open as a page" onClick={onExpand}>
							<Maximize2 />
						</Button>
					</Tooltip>
					<Tooltip content="Close the details" side="bottom">
						<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Close the details" render={<a href={hashForPullRequests(null)} />}>
							<X />
						</Button>
					</Tooltip>
				</div>
				<div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
					<DetailsScrollerContext.Provider value={scroller}>
						<PullRequestDetails workspace={workspace} hosts={hosts} target={route.target} files={route.files} placement="sidebar" />
					</DetailsScrollerContext.Provider>
				</div>
			</TooltipProvider>
		</aside>
	);
}

/**
 * The pull requests in the main area, as a table or a board: those of the sidebar's workspace, or of every workspace,
 * read from GitHub. It keeps the sidebar list's order, folds, and keys; the browser keeps which view it shows.
 */
export function PullRequestsPage({ workspace, hosts, past, section, route }: PullRequestsPageProps) {
	const { dismissStart } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const [view, setView] = usePullRequestsView();
	const board = usePullRequestsBoard({ workspace, hosts, past, route, entersList: true, view });
	useReveal(view === "list" ? section : null, board.folds, { token: section, block: "start", focus: true });
	const unmatched = board.poll.read?.data.unmatched ?? [];
	const docked = view === "board" && route.target !== null ? route : null;
	return (
		<div className="flex h-full min-h-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">
				<ListPage
					title="Pull requests"
					meta="Pull requests by whose move it is"
					noun="pull requests"
					loading="Asking GitHub for pull requests…"
					poll={board.poll}
					onRefresh={board.refresh}
					actions={
						<>
							<UnmatchedTip unmatched={unmatched} />
							<SegmentedTabs value={view} onValueChange={next => setView(next as PullRequestsView)} activationMode="manual">
								<SegmentedTabsList aria-label="View">
									<SegmentedTab value="list">List</SegmentedTab>
									<SegmentedTab value="board">Board</SegmentedTab>
								</SegmentedTabsList>
							</SegmentedTabs>
							<SortMenu order={board.order} onSort={board.onSort} onReset={board.onReset} />
						</>
					}
					notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
					className={view === "board" ? "max-w-none space-y-4" : "max-w-7xl space-y-8"}
				>
					{() => {
						if (board.repos.length === 0) return note("No session ran in a GitHub repository.");
						if (view === "list") return board.repos.map(each => <RepoTable key={each.key} view={each} />);
						return (
							<>
								{board.repos.map(({ key, name, repo }) =>
									"error" in repo ? (
										<p key={key} role="alert" className="text-sm text-red-600 dark:text-red-400">
											Cannot read {name} from GitHub: {repo.error}
										</p>
									) : null,
								)}
								<PullRequestsKanban columns={board.columns} />
							</>
						);
					}}
				</ListPage>
			</div>
			{docked && <DockedDetails workspace={workspace} hosts={hosts} route={docked} onExpand={() => setView("list")} />}
		</div>
	);
}
