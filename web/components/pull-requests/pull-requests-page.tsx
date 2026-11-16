/**
 * The Pull requests page: every pull request in a table, by repository, in a card per section named after whose move it
 * is, with the details of the pull request it shows docked beside it.
 */
import { IconArrowRotateClockwise, IconCrossMedium, IconExpand } from "central-icons";
import { type PullRequest, prKey, repoKey, type RepoPullRequests } from "../../../src/shared/github";
import { useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { filters, type ListGroup, NO_FILTER } from "../../pull-requests-filter";
import { useHiddenRepos, usePullRequestDetailsPlacement, usePullRequestsFilter, usePullRequestsFolds } from "../../pull-requests-state";
import { activityControl } from "../../activity";
import { hashForPullRequestFiles, hashForPullRequests, type PullRequestsRoute } from "../../routing";
import { useRebasing } from "../../pull-request-rebases";
import { useStoredState } from "../../stored-state";
import { DROP_LINE } from "../../order";
import { useInlineConfirm } from "../../use-inline-confirm";
import type { DragItem } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { Separator, useDragSeparator } from "../drag-separator";
import { FoldButton } from "../fold";
import { ListPage } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { SearchField } from "../search-field";
import { Spinner } from "../spinner";
import { type PullRequests, RepoReadError, type RepoView, UnmatchedTip, useGroupedList, usePullRequestKeys, usePullRequests, usePullRequestsList, workspacesLabel } from "./pull-requests-list";
import type { PullRequestDetailTab } from "./pr-details";
import { NewPullRequestButton } from "./pr-new";
import { PullRequestDetailPage, PullRequestDetails, usePullRequestCopyShortcuts } from "./pr-page";
import { PullRequestTableRow, type RowProps } from "./pr-row";
import { PullRequestViewBar } from "./pr-view-bar";

const note = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>;

const DETAILS_WIDTH = 480;
const MIN_DETAILS = 360;
const MAX_DETAILS = 1200;
/** Narrowest the list gets beside the details: a narrower page takes the width from the details. */
const MIN_LIST = 320;
const STEP = 16;

const clampDetails = (width: number, room: number): number => Math.round(Math.max(MIN_DETAILS, Math.min(MAX_DETAILS, room - MIN_LIST, width)));

/** How many pull requests a table lists, stronger for **Your move**; folded, it sums up their moves in its tooltip. */
function TableCount({ length, yours, summary }: { length: number; yours: boolean; summary: string | null }) {
	const label = `${length} pull request${length === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}`;
	const count = (
		<span
			aria-label={label}
			className={cn("text-xs tabular-nums text-muted-foreground", yours && "text-foreground")}
			style={yours ? { fontVariationSettings: fontWeights.semibold } : undefined}
		>
			{length}
		</span>
	);
	return summary ? <Tooltip content={summary}>{count}</Tooltip> : count;
}

interface TableCardProps {
	title: string;
	/** Whether it lists **Your move**, whose count draws stronger. */
	yours: boolean;
	listId: string;
	open: boolean;
	toggle: () => void;
	summary: string | null;
	rows: RowProps[];
	/** What moves it; `null` where the tables keep the list's order. */
	drag: DragItem | null;
	moveId: string | null;
}

/** A table of pull requests under a heading that folds it. */
function TableCard({ title, yours, listId, open, toggle, summary, rows, drag, moveId }: TableCardProps) {
	const headingId = `${listId}-heading`;
	return (
		<section
			aria-labelledby={headingId}
			{...drag?.target}
			data-move={moveId ?? undefined}
			className={cn("relative rounded-md border border-border", drag?.dragging && "opacity-50", drag?.dropAt && DROP_LINE[drag.dropAt])}
		>
			<h3 id={headingId} {...drag?.handle} className={cn("flex items-center gap-2 bg-muted/50 px-3 py-1.5 text-sm font-medium", open && rows.length > 0 ? "rounded-t-md" : "rounded-md")}>
				<FoldButton open={open} onToggle={toggle} controls={listId} className="items-center">
					{title}
				</FoldButton>
				<TableCount length={rows.length} yours={yours} summary={summary} />
			</h3>
			{open && rows.length > 0 && (
				<ul id={listId} aria-label={title} className="divide-y divide-border border-t border-border">
					{rows.map(row => (
						<PullRequestTableRow key={prKey(row.row.pr)} {...row} />
					))}
				</ul>
			)}
		</section>
	);
}

function RepoTable({ view }: { view: RepoView }) {
	const { repo, name, bodyId, open, toggle, drag, moveId, sections } = view;
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
						<RepoReadError name={name} error={repo.error} className="text-sm" />
					) : sections.length === 0 ? (
						note("No open pull requests of yours and no reviews waiting on you.")
					) : (
						sections.map(({ section, ...card }) => <TableCard key={section.title} {...card} title={section.title} yours={section.title === "Your move"} />)
					)}
				</div>
			)}
		</section>
	);
}

/** The list's tables, one per repository, which you drag or move with the keys. */
function RepoTables({ pulls }: { pulls: PullRequests }) {
	return (
		<div className="space-y-8">
			{usePullRequestsList(pulls).map(each => (
				<RepoTable key={each.key} view={each} />
			))}
		</div>
	);
}

/** The list under a grouping other than by repository: a heading per group, each with its tables, in the list's order. */
function GroupedTables({ pulls, groups }: { pulls: PullRequests; groups: ListGroup[] }) {
	return (
		<div className="space-y-8">
			{useGroupedList(pulls, groups).map(({ key, title, bodyId, open, toggle, cards }) => {
				const tables = cards.map(({ key, section, ...card }) => <TableCard key={key} {...card} yours={section === "Your move"} summary={null} drag={null} moveId={null} />);
				if (title === null)
					return (
						<div key={key} className="@container/pull-requests">
							{tables}
						</div>
					);
				return (
					<section key={key} aria-label={title} className="@container/pull-requests space-y-3">
						<h2 className="flex items-baseline gap-2 text-sm" style={{ fontVariationSettings: fontWeights.semibold }}>
							<FoldButton open={open} onToggle={toggle} controls={bodyId}>
								<span className="truncate">{title}</span>
								<span className="text-xs tabular-nums text-muted-foreground" style={{ fontVariationSettings: fontWeights.normal }}>
									{cards.reduce((sum, { rows }) => sum + rows.length, 0)}
								</span>
							</FoldButton>
						</h2>
						{open && (
							<div id={bodyId} className="space-y-3">
								{tables}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}

/** What the list shows: the tables, a note while the search or the filters keep nothing, or one while you hid every repository. */
function PullRequestsBody({ pulls, query, onQuery }: { pulls: PullRequests; query: string; onQuery: (query: string) => void }) {
	const [hidden] = useHiddenRepos();
	const [filter, setFilter] = usePullRequestsFilter();
	if (pulls.everyRepo.length === 0) return note("No session ran in a GitHub repository.");
	if (pulls.everyRepo.every(repo => hidden.has(repoKey(repo)))) return <EveryRepositoryHidden everyRepo={pulls.everyRepo} />;
	const empty = pulls.groups ? pulls.groups.length === 0 : pulls.repos.length === 0;
	if (empty) {
		const searching = query.trim() !== "";
		const filtering = filters(filter);
		const what = searching && filtering ? "the search and these filters" : searching ? `“${query.trim()}”` : "these filters";
		return (
			<div className="space-y-3">
				{note(`No pull requests match ${what}.`)}
				<Button
					{...activityControl("pull-requests.filter.clear")}
					size="compact"
					variant="outline"
					onClick={() => {
						if (searching) onQuery("");
						if (filtering) setFilter(NO_FILTER);
					}}
				>
					{searching && filtering ? "Clear the search and filters" : searching ? "Clear the search" : "Clear the filters"}
				</Button>
			</div>
		);
	}
	return pulls.groups ? <GroupedTables pulls={pulls} groups={pulls.groups} /> : <RepoTables pulls={pulls} />;
}

/** What the page shows while you hid every repository of `everyRepo`, with a button that shows them all again. */
function EveryRepositoryHidden({ everyRepo }: { everyRepo: RepoPullRequests[] }) {
	const [, toggleHidden] = useHiddenRepos();
	return (
		<div className="space-y-3">
			{note("Every repository is hidden. Show them from Display, then Repositories.")}
			<Button {...activityControl("pull-requests.repositories.show-all")} size="compact" variant="outline" onClick={() => toggleHidden(...everyRepo.map(repoKey))}>
				Show all repositories
			</Button>
		</div>
	);
}

/** The details of the pull request `route` names, docked beside the list at the width you drag their edge to, with buttons that show them as a page or close them. */
function DockedDetails({ hosts, route, onExpand }: { hosts: RosterHost[]; route: Extract<PullRequestsRoute, { target: PullRequest }>; onExpand: () => void }) {
	// The docked details keep their own tab, starting on Code when the route opens a file.
	const [tab, setTab] = useState<PullRequestDetailTab>(route.files ? "code" : "summary");
	usePullRequestCopyShortcuts(route.target);
	const [width, setWidth] = useStoredState("omp-agents.pr-details-width", raw => {
		const stored = Number(raw);
		return stored >= MIN_DETAILS && stored <= MAX_DETAILS ? stored : DETAILS_WIDTH;
	});
	const room = (element: HTMLElement): number => (element.closest("aside")?.parentElement as HTMLElement).clientWidth;
	// The line sits on the details' left edge: dragging it left widens them.
	const resize = useDragSeparator({
		value: width,
		onValue: setWidth,
		axis: "vertical",
		direction: -1,
		keyStep: STEP,
		shiftSteps: 4,
		min: MIN_DETAILS,
		max: MAX_DETAILS,
		reset: DETAILS_WIDTH,
		size: room,
		clamp: (next, element) => clampDetails(next, room(element)),
		read: (event, start) => clampDetails(start.value - (event.clientX - start.coordinate), start.size),
	});
	const expand = (): void => {
		// The page takes Code from the route alone, so expanding on Code puts it in the address.
		if (tab === "code" && !route.files) location.hash = hashForPullRequestFiles(route.target);
		onExpand();
	};
	return (
		<aside aria-label="Pull request details" style={{ width }} className="relative flex max-w-[calc(100%-20rem)] shrink-0 flex-col border-l border-border">
			<Separator {...resize} axis="vertical" label="Resize the pull request details" min={MIN_DETAILS} max={MAX_DETAILS} now={width} className="inset-y-0 -left-1.5 w-3 cursor-col-resize select-none" />
			<TooltipProvider>
				<div className="flex h-(--page-header-height) shrink-0 items-center justify-end gap-1 border-b border-border px-3">
					<Tooltip content="Open as a page" side="bottom">
						<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Open as a page" onClick={expand}>
							<IconExpand />
						</Button>
					</Tooltip>
					<Tooltip content="Close the details" side="bottom">
						<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Close the details" render={<a href={hashForPullRequests(null)} />}>
							<IconCrossMedium />
						</Button>
					</Tooltip>
				</div>
				<div className="flex min-h-0 flex-1 flex-col">
					<PullRequestDetails hosts={hosts} target={route.target} path={route.files?.path ?? null} tab={tab} onTab={setTab} placement="sidebar" findable />
				</div>
			</TooltipProvider>
		</aside>
	);
}

/**
 * **Rebase behind**: once you confirm, rebases each of your pull requests behind its base, with the stacks above them,
 * bottom first. It waits while any rebase is queued or running; nothing shows while none is behind.
 */
function RebaseBehindButton({ pulls }: { pulls: PullRequests }) {
	const rebasing = useRebasing();
	const confirm = useInlineConfirm("rebase-behind");
	const count = pulls.behind.length;
	if (count === 0) return null;
	const armed = confirm.isArmed("rebase");
	const label = rebasing ? "Rebasing…" : armed ? `Confirm rebase of ${count}?` : `Rebase ${count} behind`;
	return (
		<Tooltip content="Rebase each of your pull requests behind its base, and the ones stacked on them, bottom first: each runs the repository's pre-push checks and pushes with --force-with-lease" forceOpen={armed ? false : undefined}>
			<Button size="compact" variant="outline" leadingIcon={rebasing ? Spinner : IconArrowRotateClockwise} disabled={rebasing} aria-busy={rebasing} aria-label={label} {...confirm.props("rebase", pulls.onRebaseBehind)}>
				{label}
			</Button>
		</Tooltip>
	);
}

interface PullRequestsPageProps {
	hosts: RosterHost[];
	past: PastSession[];
	/** The pull request whose details the page shows: docked beside the list, or on a page of their own. */
	route: PullRequestsRoute;
}

/** The Pull requests page: a pull request's details on a page of their own while you chose so and `route` names one; else the pull requests' table. */
export function PullRequestsPage(props: PullRequestsPageProps) {
	const [placement, setPlacement] = usePullRequestDetailsPlacement();
	const { hosts, past, route } = props;
	if (route.target && placement === "page")
		return <DetailsPage key={prKey(route.target)} hosts={hosts} past={past} route={route} onDock={() => setPlacement("beside")} />;
	return <PullRequestsOverview {...props} onExpand={() => setPlacement("page")} />;
}

/** A pull request's details on a page of their own, whose keys step through the list's pull requests in its order, leaving out what its folds hide. */
function DetailsPage({ hosts, past, route, onDock }: { hosts: RosterHost[]; past: PastSession[]; route: Extract<PullRequestsRoute, { target: PullRequest }>; onDock: () => void }) {
	const pulls = usePullRequests({ hosts, past, route, query: "" });
	usePullRequestKeys(pulls, usePullRequestsFolds().isFolded);
	return <PullRequestDetailPage hosts={hosts} target={route.target} files={route.files} onDock={onDock} />;
}

/**
 * The pull requests in the main area, as a table per repository: those of the sidebar's workspace, or of every
 * workspace, read from GitHub, leaving out the repositories you hid.
 */
function PullRequestsOverview({ hosts, past, route, onExpand }: PullRequestsPageProps & { onExpand: () => void }) {
	const { dismissStart } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const [query, setQuery] = useState("");
	const pulls = usePullRequests({ hosts, past, route, query });
	const unmatched = pulls.poll.read?.data.unmatched ?? [];
	const docked = route.target !== null ? route : null;
	return (
		<div className="flex h-full min-h-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">
				<ListPage
					title="Pull requests"
					meta="Pull requests by whose move it is"
					noun="pull requests"
					loading="Asking GitHub for pull requests…"
					poll={pulls.poll}
					onRefresh={pulls.refresh}
					actions={
						<>
							<UnmatchedTip unmatched={unmatched} />
							<RebaseBehindButton pulls={pulls} />
							<span {...activityControl("pull-requests.search")}>
								<SearchField label="Search pull requests" placeholder="Search" query={query} onQuery={setQuery} className="w-36" />
							</span>
							{pulls.everyRepo.length > 0 && <NewPullRequestButton everyRepo={pulls.everyRepo} />}
						</>
					}
					notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
					className="max-w-7xl space-y-4"
				>
					{() => (
						<>
							<PullRequestViewBar pulls={pulls} />
							<PullRequestsBody pulls={pulls} query={query} onQuery={setQuery} />
						</>
					)}
				</ListPage>
			</div>
			{docked && <DockedDetails hosts={hosts} route={docked} onExpand={onExpand} />}
		</div>
	);
}
