/**
 * The Pull requests page: every pull request in a table, by repository, in a card per section named after whose move it
 * is, with the details of the pull request it shows docked beside it.
 */
import { IconArrowRotateClockwise, IconCrossMedium, IconExpand, IconSettingsSliderHor } from "central-icons";
import { type PullRequest, prKey, repoKey, type RepoPullRequests, repoName } from "../../../src/shared/github";
import { useId, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { type PullRequestOrder, withRepoStepped } from "../../pull-requests-model";
import { useHiddenRepos, usePullRequestDetailsPlacement, usePullRequestsFolds } from "../../pull-requests-state";
import { activityControl } from "../../activity";
import { hashForPullRequestFiles, hashForPullRequests, type PullRequestsRoute } from "../../routing";
import { useRebasing } from "../../pull-request-rebases";
import { useStoredState } from "../../stored-state";
import { DROP_LINE } from "../../order";
import { useInlineConfirm } from "../../use-inline-confirm";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { Separator, useDragSeparator } from "../drag-separator";
import { FoldButton } from "../fold";
import { ListPage } from "../list-page";
import { QuickStartNotice } from "../quick-actions";
import { ShownOrderList } from "../shown-order-list";
import { Spinner } from "../spinner";
import { type PullRequests, RepoReadError, type RepoView, type SectionView, SortMenu, UnmatchedTip, usePullRequestKeys, usePullRequests, usePullRequestsList, workspacesLabel } from "./pull-requests-list";
import type { PullRequestDetailTab } from "./pr-details";
import { PullRequestDetailPage, PullRequestDetails, usePullRequestCopyShortcuts } from "./pr-page";
import { PullRequestTableRow } from "./pr-row";

const note = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>;

const DETAILS_WIDTH = 480;
const MIN_DETAILS = 360;
const MAX_DETAILS = 1200;
/** Narrowest the list gets beside the details: a narrower page takes the width from the details. */
const MIN_LIST = 320;
const STEP = 16;

const clampDetails = (width: number, room: number): number => Math.round(Math.max(MIN_DETAILS, Math.min(MAX_DETAILS, room - MIN_LIST, width)));

/** How many pull requests a section lists; folded, it sums up their moves in its tooltip. */
function SectionCount({ section: { section, summary } }: { section: SectionView }) {
	const { length } = section.rows;
	const yours = section.title === "Your move";
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

function SectionCard({ view }: { view: SectionView }) {
	const { section, listId, open, toggle, drag, moveId, rows } = view;
	const headingId = `${listId}-heading`;
	return (
		<section
			aria-labelledby={headingId}
			{...drag.target}
			data-move={moveId}
			className={cn("relative rounded-md border border-border", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}
		>
			<h3 id={headingId} {...drag.handle} className="flex items-center gap-2 rounded-t-md bg-muted/50 px-3 py-1.5 text-sm font-medium">
				<FoldButton open={open} onToggle={toggle} controls={listId} className="items-center">
					{section.title}
				</FoldButton>
				<SectionCount section={view} />
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
						sections.map(section => <SectionCard key={section.section.title} view={section} />)
					)}
				</div>
			)}
		</section>
	);
}

/** The list's tables, one per repository. */
function RepoTables({ pulls }: { pulls: PullRequests }) {
	return usePullRequestsList(pulls).map(each => <RepoTable key={each.key} view={each} />);
}

/**
 * **Repositories**: `everyRepo`, every repository of the list in page order, each with a switch that shows or hides it
 * and buttons that move it one place among all of them, so a hidden one can move too.
 */
function RepositoriesMenu({ everyRepo, order, setOrder }: { everyRepo: RepoPullRequests[]; order: PullRequestOrder; setOrder: (order: PullRequestOrder) => void }) {
	const [open, setOpen] = useState(false);
	const [hidden, toggleHidden] = useHiddenRepos();
	const titleId = useId();
	const rows = everyRepo.map(repo => {
		const key = repoKey(repo);
		return { key, label: repoName(repo), shown: !hidden.has(key) };
	});
	const keys = rows.map(({ key }) => key);
	const hiddenCount = rows.filter(({ shown }) => !shown).length;
	const label = hiddenCount === 0 ? "Repositories" : `Repositories: ${hiddenCount} hidden`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button
						{...activityControl("pull-requests.repositories")}
						variant="ghost"
						size={hiddenCount === 0 ? "icon-compact" : "compact"}
						leadingIcon={hiddenCount === 0 ? undefined : IconSettingsSliderHor}
						aria-label={`${label}. Hide repositories or change their order`}
						data-state={open ? "open" : "closed"}
						active={open}
					>
						{hiddenCount === 0 ? <IconSettingsSliderHor /> : `${hiddenCount} hidden`}
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent
				align="end"
				collisionPadding={8}
				aria-labelledby={titleId}
				className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto p-3"
			>
				<PopoverHeader>
					<PopoverTitle id={titleId} className="text-sm">
						Repositories
					</PopoverTitle>
					<PopoverDescription className="text-xs">Hidden repositories also leave the tab's count. Saved in this browser.</PopoverDescription>
				</PopoverHeader>
				<ShownOrderList
					rows={rows}
					onShow={key => toggleHidden(key)}
					onMove={(key, by) => {
						const next = withRepoStepped(order, keys, keys, key, by);
						if (next) setOrder(next);
					}}
					controls={{ show: "pull-requests.repository.toggle", move: "pull-requests.repository.move" }}
				/>
			</PopoverContent>
		</Popover>
	);
}

/** What the page shows while you hid every repository of `everyRepo`, with a button that shows them all again. */
function EveryRepositoryHidden({ everyRepo }: { everyRepo: RepoPullRequests[] }) {
	const [, toggleHidden] = useHiddenRepos();
	return (
		<div className="space-y-3">
			{note("Every repository is hidden. Show them from Repositories.")}
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
	const pulls = usePullRequests({ hosts, past, route });
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
	const pulls = usePullRequests({ hosts, past, route });
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
							<SortMenu order={pulls.order} onSort={pulls.onSort} onReset={pulls.onReset} />
							{pulls.everyRepo.length > 0 && <RepositoriesMenu everyRepo={pulls.everyRepo} order={pulls.order} setOrder={pulls.setOrder} />}
						</>
					}
					notice={quick && <QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />}
					className="max-w-7xl space-y-8"
				>
					{() => {
						if (pulls.everyRepo.length === 0) return note("No session ran in a GitHub repository.");
						if (pulls.repos.length === 0) return <EveryRepositoryHidden everyRepo={pulls.everyRepo} />;
						return <RepoTables pulls={pulls} />;
					}}
				</ListPage>
			</div>
			{docked && <DockedDetails hosts={hosts} route={docked} onExpand={onExpand} />}
		</div>
	);
}
