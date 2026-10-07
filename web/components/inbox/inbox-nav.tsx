import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { repoKey } from "../../../src/shared/github";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { agentOn, inboxSections, orderedRepos } from "../../inbox-model";
import { readTime } from "../../labels";
import { inboxStore } from "../../reads";
import { hashForInbox, type InboxRoute } from "../../routing";
import type { SectionTarget } from "../../section";
import { DROP_LINE, useDragOrder } from "../../use-drag-order";
import { useDashboardContext } from "../dashboard-context";
import { FoldButton } from "../fold";
import { QuickStartNotice } from "../quick-actions";
import { SectionLink } from "../section-link";
import { inboxSection, type RepoView, type SectionView, SortMenu, UnmatchedTip, useInboxBoard, useInboxOrder, withRepoMoved, workspacesLabel } from "./inbox-board";
import { PullRequestRow } from "./pr-row";

const note = (text: string) => <p className="px-3 py-1 text-xs text-muted-foreground">{text}</p>;

/** How many pull requests a section lists; folded, it sums up their moves in its tooltip. */
export function SectionCount({ section: { section, summary }, className }: { section: SectionView; className?: string }) {
	const { length } = section.rows;
	const yours = section.title === "Your move";
	const label = `${length} pull request${length === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}`;
	const count = (
		<span
			aria-label={label}
			className={cn("tabular-nums", yours && "text-foreground", className)}
			style={yours ? { fontVariationSettings: fontWeights.semibold } : undefined}
		>
			{length}
		</span>
	);
	return summary ? <Tooltip content={summary}>{count}</Tooltip> : count;
}

function SectionBlock({ view }: { view: SectionView }) {
	const { section, listId, open, toggle, drag, moveId, rows } = view;
	return (
		<div {...drag.target} data-move={moveId} className={cn("relative", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}>
			<h4 {...drag.handle} className="flex h-6 items-center gap-2 pr-2 pl-2 text-xs text-muted-foreground">
				<FoldButton open={open} onToggle={toggle} controls={listId} className="min-w-0 flex-1">
					<span className="truncate">{section.title}</span>
				</FoldButton>
				<SectionCount section={view} />
			</h4>
			{open && (
				<ul id={listId} aria-label={section.title}>
					{rows.map(row => (
						<PullRequestRow key={row.row.pr.number} {...row} />
					))}
				</ul>
			)}
		</div>
	);
}

function RepoBlock({ view }: { view: RepoView }) {
	const { repo, name, bodyId, open, toggle, drag, moveId, sections } = view;
	const workspaces = workspacesLabel(repo);
	let body: ReactNode;
	if ("error" in repo) {
		body = (
			<p role="alert" className="px-3 py-1 text-xs text-red-600 dark:text-red-400">
				Cannot read {name} from GitHub: {repo.error}
			</p>
		);
	} else if (sections.length === 0) body = note("No open pull requests of yours and no reviews waiting on you.");
	else body = sections.map(section => <SectionBlock key={section.section.title} view={section} />);
	return (
		<section aria-label={name} {...drag.target} data-move={moveId} className={cn("relative px-1", drag.dragging && "opacity-50", drag.dropAt && DROP_LINE[drag.dropAt])}>
			<h3 {...drag.handle} className="flex h-7 items-center px-2 text-xs" style={{ fontVariationSettings: fontWeights.semibold }}>
				<FoldButton open={open} onToggle={toggle} controls={bodyId} className="flex-1">
					<span className="truncate" title={repo.cwds.join("\n")}>
						{name}
					</span>
					{workspaces && (
						<span className="truncate text-muted-foreground" style={{ fontVariationSettings: fontWeights.normal }}>
							{workspaces}
						</span>
					)}
				</FoldButton>
			</h3>
			{open && (
				<div id={bodyId} className="space-y-1">
					{body}
				</div>
			)}
		</section>
	);
}

interface InboxNavProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** What the main area shows: a pull request's row unfolds, scrolls into view, and stays highlighted while its details or changes show. */
	route: InboxRoute;
}

/**
 * The sidebar's inbox beside the panes or a pull request's details: the pull requests of its project, or of every
 * project, by repository in sections named after whose move it is, read from GitHub.
 */
export function InboxNav({ project, hosts, past, route }: InboxNavProps) {
	const { dismissStart, starts: { quick } } = useDashboardContext();
	const board = useInboxBoard({ project, hosts, past, route });
	const { read, error, refreshing } = board.poll;
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1 pr-2 pl-3 text-xs text-muted-foreground">
				<span className="min-w-0 flex-1 truncate">{read ? `Updated ${readTime(read.at)}` : "Asking GitHub for pull requests…"}</span>
				{read && <UnmatchedTip unmatched={read.data.unmatched} />}
				<SortMenu order={board.order} onSort={board.onSort} onReset={board.onReset} />
				<Tooltip content="Refresh the inbox">
					<Button variant="ghost" size="icon-compact" aria-label="Refresh the inbox" loading={refreshing} onClick={board.refresh}>
						<RefreshCw />
					</Button>
				</Tooltip>
			</div>
			{error && (
				<p role="alert" className="px-3 text-xs text-red-600 dark:text-red-400">
					Cannot {read ? "refresh" : "load"} the inbox: {error}
				</p>
			)}
			{quick && (
				<div className="px-2">
					<QuickStartNotice quick={quick} onDismiss={() => dismissStart("quick")} />
				</div>
			)}
			{read && board.repos.length === 0 && note("No session ran in a GitHub repository.")}
			{board.repos.map(view => (
				<RepoBlock key={view.key} view={view} />
			))}
		</div>
	);
}

interface InboxIndexProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	target: SectionTarget | null;
	onTarget: (target: SectionTarget) => void;
}

/** The sidebar beside the inbox page: each repository's sections with their pull request counts, each a link to its card on the page. Drag a repository's name to reorder them, as on the page. */
export function InboxIndex({ project, hosts, target, onTarget }: InboxIndexProps) {
	const { read, error } = inboxStore.use(project);
	const [order, setOrder] = useInboxOrder();
	const drag = useDragOrder();
	if (!read) return note(error ? `Cannot load the inbox: ${error}` : "Asking GitHub for pull requests…");
	const agent = agentOn(hosts);
	const repos = orderedRepos(read.data.repos, order);
	if (repos.length === 0) return note("No session ran in a GitHub repository.");
	const repoKeys = repos.map(repoKey);
	return repos.map(repo => {
		const key = repoKey(repo);
		const name = `${repo.owner}/${repo.repo}`;
		const sections = "error" in repo ? [] : inboxSections(repo.pullRequests, order, agent);
		const item = drag("repos", key, (dragged, where) => setOrder(withRepoMoved(order, repoKeys, dragged, key, where)));
		return (
			<SidebarGroup key={key} {...item.target} className={cn(item.dragging && "opacity-50", item.dropAt && DROP_LINE[item.dropAt])}>
				<SidebarGroupLabel {...item.handle}>{name}</SidebarGroupLabel>
				{"error" in repo && note("Cannot read it from GitHub.")}
				{sections.length > 0 && (
					<SidebarMenu aria-label={`${name} sections`}>
						{sections.map(({ title, rows: { length } }) => (
							<SectionLink
								key={title}
								href={hashForInbox(null)}
								section={inboxSection(key, title)}
								chosen={target}
								title={title}
								label={`${title}, ${length} pull request${length === 1 ? "" : "s"}`}
								count={length}
								onChoose={onTarget}
							/>
						))}
					</SidebarMenu>
				)}
			</SidebarGroup>
		);
	});
}

