import { ArrowDownUp, RefreshCw } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type Inbox, type InboxPullRequest, type PastSession, type PullRequest, prKey, pullRequestUrl, type RepoInbox, type RosterHost, repoKey, samePullRequest } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import {
	DEFAULT_ORDER,
	decodeOrder,
	foldedByDefault,
	INBOX_SORTS,
	type InboxOrder,
	type InboxSort,
	inboxSections,
	moveKey,
	orderedRepos,
	placedManual,
	sectionFoldKey,
	sectionTitles,
	shownPullRequests,
	stepTarget,
	type Waiting,
	type Where,
} from "../../inbox-model";
import { projectName, readTime } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, pullRequestStart } from "../../quick-actions";
import { inboxStore } from "../../reads";
import { hashForInbox } from "../../routing";
import { sectionId } from "../../section";
import { useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { DROP_LINE, useDragOrder } from "../../use-drag-order";
import { useDashboardContext } from "../dashboard-context";
import { FoldButton, useFolds, useReveal } from "../fold";
import { QuickStartNotice } from "../quick-actions";
import { PullRequestRow, rowId, sessionsFor } from "./pr-row";

/** The repositories and sections flipped from their default fold: `owner/repo`, and `owner/repo:<section title>`. */
const FOLDS_KEY = "omp-agents.inbox-collapsed";
const ORDER_KEY = "omp-agents.inbox-order";

/** The count of a section that waits on your move: a review asked of you, or a pull request a reviewer sent back. */
const WAITING_COUNT: Record<Waiting, string> = {
	"your-review": "text-foreground",
	"your-fix": "text-red-600 dark:text-red-400",
};

const SORTS = Object.keys(INBOX_SORTS) as InboxSort[];

/** Moves a focused heading or row one place; `false` at the edge. */
type Move = (by: 1 | -1) => boolean;

const note = (text: string) => <p className="px-3 py-1 text-xs text-muted-foreground">{text}</p>;

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

/**
 * J and K move between the rows `shown` lists, or, while the main area shows a pull request, show the next or previous
 * one. O opens the pull request on GitHub, and `.` opens a row's quick actions. A key that has nothing to act on keeps
 * its usual meaning.
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

/** Alt+Shift+↑ and ↓ move the focused heading or row, by its `data-move`. Focus follows it, since React may re-insert its element. */
function useMoveKeys(moves: ReadonlyMap<string, Move>): void {
	const moved = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => {
		const element = moved.current;
		moved.current = null;
		if (!element?.isConnected) return;
		if (document.activeElement !== element) element.focus({ preventScroll: true });
		element.scrollIntoView({ block: "nearest" });
	});
	const move = (by: 1 | -1): boolean => {
		const focused = document.activeElement;
		if (!(focused instanceof HTMLElement)) return false;
		const id = focused.closest("[data-move]")?.getAttribute("data-move");
		const step = id ? moves.get(id) : undefined;
		if (!step?.(by)) return false;
		moved.current = focused;
		return true;
	};
	useShortcuts({ moveUp: () => move(-1), moveDown: () => move(1) });
}

function SortMenu({ order, onSort, onReset }: { order: InboxOrder; onSort: (sort: InboxSort) => void; onReset: () => void }) {
	const [open, setOpen] = useState(false);
	const label = `Sort: ${INBOX_SORTS[order.sort]}`;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`${label}. Change the inbox's order`} />}>
					<ArrowDownUp />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-52">
				<MenuRadioGroup value={order.sort} onValueChange={(sort: InboxSort) => onSort(sort)}>
					{SORTS.map(sort => (
						<MenuRadioItem key={sort} value={sort} closeOnClick>
							{INBOX_SORTS[sort]}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuItem disabled={JSON.stringify(order) === JSON.stringify(DEFAULT_ORDER)} onClick={onReset}>
					Reset the order
				</MenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface InboxNavProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The pull request whose details the main area shows: its row unfolds, scrolls into view, and stays highlighted. */
	target: PullRequest | null;
}

/**
 * The sidebar's inbox: the pull requests of its project, or of every project, by repository in Graphite's inbox
 * sections, read from GitHub. Dragging or Alt+Shift+↑ and ↓ reorder the repositories, the sections, and the pull
 * requests in a section; the browser keeps the order.
 */
export function InboxNav({ project, hosts, past, target }: InboxNavProps) {
	const { open, start, dismissStart, starts: { quick } } = useDashboardContext();
	const { read, error, refreshing } = inboxStore.use(project);
	const folds = useFolds(FOLDS_KEY, foldedByDefault);
	const [order, setOrder] = useStoredState(ORDER_KEY, decodeOrder, JSON.stringify);
	const drag = useDragOrder();
	const moves = new Map<string, Move>();
	const place = read && target ? placeOf(read.data, target) : null;
	const reveal = target && place ? { id: rowId(target), folds: [place.repo, place.section] } : null;
	useReveal(reveal, folds, { token: reveal?.id, block: "nearest", focus: false });
	useTriageKeys(read ? shownPullRequests(read.data, folds.isFolded, order) : [], target);
	useMoveKeys(moves);

	const repos = read ? orderedRepos(read.data.repos, order) : [];
	const repoKeys = repos.map(repoKey);
	// The page shows its pull requests in this order now; placing one by hand starts the manual sort from it.
	const shownOrder = order.sort === "manual" && order.manual.length > 0
		? order.manual
		: repos.flatMap(repo => ("error" in repo ? [] : inboxSections(repo.pullRequests, order).flatMap(({ rows }) => rows.map(row => prKey(row.pr)))));
	const moveRepo = (key: string, beside: string, where: Where): void =>
		// Repositories of other projects keep their place behind the ones shown.
		setOrder({ ...order, repos: moveKey([...repoKeys, ...order.repos.filter(other => !repoKeys.includes(other))], key, beside, where) });
	const moveSection = (title: string, beside: string, where: Where): void => setOrder({ ...order, sections: moveKey(sectionTitles(order), title, beside, where) });
	const onSort = (sort: InboxSort): void => setOrder({ ...order, sort, manual: sort === "manual" ? shownOrder : order.manual });

	const repoBlock = (repo: RepoInbox): ReactNode => {
		const key = repoKey(repo);
		const name = `${repo.owner}/${repo.repo}`;
		const bodyId = sectionId("inbox", key);
		const isOpen = !folds.isFolded(key);
		const item = drag("repos", key, (dragged, where) => moveRepo(dragged, key, where));
		const moveId = `repo:${key}`;
		moves.set(moveId, by => {
			const step = stepTarget(repoKeys, key, by);
			if (step) moveRepo(key, step.target, step.where);
			return step !== null;
		});
		const sections = "error" in repo ? [] : inboxSections(repo.pullRequests, order);
		const titles = sections.map(({ title }) => title);
		let body: ReactNode;
		if ("error" in repo) {
			body = (
				<p role="alert" className="px-3 py-1 text-xs text-red-600 dark:text-red-400">
					Cannot read {name} from GitHub: {repo.error}
				</p>
			);
		} else if (sections.length === 0) {
			body = note("No open pull requests of yours and no reviews waiting on you.");
		} else {
			body = sections.map(section => {
				const foldKey = sectionFoldKey(key, section.title);
				const sectionOpen = !folds.isFolded(foldKey);
				const listId = sectionId("inbox", key, section.title);
				const sectionItem = drag(`sections:${key}`, section.title, (dragged, where) => moveSection(dragged, section.title, where));
				const sectionMoveId = `section:${foldKey}`;
				moves.set(sectionMoveId, by => {
					const step = stepTarget(titles, section.title, by);
					if (step) moveSection(section.title, step.target, step.where);
					return step !== null;
				});
				const units = [...new Set(section.rows.map(({ unit }) => unit))];
				const placeUnit = (unit: string, beside: string, where: Where): void =>
					setOrder({ ...order, sort: "manual", manual: placedManual(shownOrder, repo, sections, section.title, unit, beside, where) });
				const { length } = section.rows;
				return (
					<div
						key={section.title}
						{...sectionItem.target}
						data-move={sectionMoveId}
						className={cn("relative", sectionItem.dragging && "opacity-50", sectionItem.dropAt && DROP_LINE[sectionItem.dropAt])}
					>
						<h4 {...sectionItem.handle} className="flex h-6 items-center gap-2 pr-2 pl-2 text-xs text-muted-foreground">
							<FoldButton open={sectionOpen} onToggle={() => folds.toggle(foldKey)} controls={listId} className="flex-1">
								<span className="truncate">{section.title}</span>
							</FoldButton>
							<span
								aria-label={`${length} pull request${length === 1 ? "" : "s"}`}
								className={cn("tabular-nums", section.waiting && WAITING_COUNT[section.waiting])}
								style={section.waiting ? { fontVariationSettings: fontWeights.semibold } : undefined}
							>
								{length}
							</span>
						</h4>
						{sectionOpen && (
							<ul id={listId} aria-label={section.title}>
								{section.rows.map((row, at) => {
									const rowItem = drag(`pull-requests:${foldKey}`, row.unit, (dragged, where) => placeUnit(dragged, row.unit, where));
									// A stack takes a drop as one: the line shows above its top row or under its bottom one.
									const edge = rowItem.dropAt === "before" ? section.rows[at - 1] : section.rows[at + 1];
									const rowMoveId = `pull-request:${prKey(row.pr)}`;
									moves.set(rowMoveId, by => {
										const step = stepTarget(units, row.unit, by);
										if (step) placeUnit(row.unit, step.target, step.where);
										return step !== null;
									});
									return (
										<PullRequestRow
											key={row.pr.number}
											row={row}
											sessions={sessionsFor(row.pr, hosts, past)}
											targeted={target !== null && samePullRequest(row.pr, target)}
											onOpen={open}
											pending={pendingOf(quick, { kind: "pull-request", pr: row.pr })}
											onQuickAction={action => start(pullRequestStart(row.pr, action, repo.cwds[0]!, readPinnedSkill()))}
											drag={{ ...rowItem, dropAt: edge?.unit === row.unit ? null : rowItem.dropAt }}
											moveId={rowMoveId}
										/>
									);
								})}
							</ul>
						)}
					</div>
				);
			});
		}
		return (
			<section key={key} aria-label={name} {...item.target} data-move={moveId} className={cn("relative px-1", item.dragging && "opacity-50", item.dropAt && DROP_LINE[item.dropAt])}>
				<h3 {...item.handle} className="flex h-7 items-center px-2 text-xs" style={{ fontVariationSettings: fontWeights.semibold }}>
					<FoldButton open={isOpen} onToggle={() => folds.toggle(key)} controls={bodyId} className="flex-1">
						<span className="truncate">{name}</span>
						<span className="truncate text-muted-foreground" style={{ fontVariationSettings: fontWeights.normal }} title={repo.cwds.join("\n")}>
							{repo.cwds.length === 1 ? projectName(repo.cwds[0]!) : `${repo.cwds.length} workspaces`}
						</span>
					</FoldButton>
				</h3>
				{isOpen && (
					<div id={bodyId} className="space-y-1">
						{body}
					</div>
				)}
			</section>
		);
	};

	return (
		<div className="space-y-2 pb-2">
			<div className="flex items-center gap-1 pr-2 pl-3 text-xs text-muted-foreground">
				<span className="min-w-0 flex-1 truncate">{read ? `Updated ${readTime(read.at)}` : "Asking GitHub for pull requests…"}</span>
				<SortMenu order={order} onSort={onSort} onReset={() => setOrder(DEFAULT_ORDER)} />
				<Tooltip content="Refresh the inbox">
					<Button variant="ghost" size="icon-compact" aria-label="Refresh the inbox" loading={refreshing} onClick={() => void inboxStore.refresh(project, { fresh: true })}>
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
			{read && repos.length === 0 && note("No session ran in a GitHub repository.")}
			{repos.map(repoBlock)}
			{read && read.data.unmatched.length > 0 && (
				<p className="px-3 text-xs text-muted-foreground" title={read.data.unmatched.join("\n")}>
					{read.data.unmatched.length === 1 ? "1 workspace has no GitHub origin and is" : `${read.data.unmatched.length} workspaces have no GitHub origin and are`} left out.
				</p>
			)}
		</div>
	);
}
