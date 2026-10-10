/** What the two lists of pull requests share, the sidebar's and the page's: their state, their keys, and the board they render. */
import { ArrowDownUp, Unplug } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type PullRequestActionId, pullRequestActions } from "../../../src/pull-request-actions";
import { type PullRequestList, type PullRequestSummary, type PullRequest, prKey, pullRequestUrl, type RepoPullRequests, repoKey, samePullRequest } from "../../../src/shared/github";
import { type AgentOn, agentOn, moveOf } from "../../../src/shared/moves";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
	DEFAULT_ORDER,
	decodeOrder,
	foldedByDefault,
	PULL_REQUEST_SORTS,
	type PullRequestOrder,
	type SectionRow,
	type PullRequestSection,
	type MoveGroup,
	type PullRequestSort,
	pullRequestSections,
	listedPullRequest,
	moveAction,
	moveKey,
	movesSummary,
	orderedRepos,
	placedManual,
	sectionFoldKey,
	sectionTitles,
	shownPullRequests,
	stepTarget,
	type Where,
} from "../../pull-requests-model";
import { folderName } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, pullRequestStart } from "../../quick-actions";
import type { PolledEntry } from "../../polled-store";
import { pullRequestsStore } from "../../reads";
import { hashForPullRequests, type PullRequestsRoute } from "../../routing";
import { type SectionTarget, sectionId } from "../../section";
import { useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { type DragItem, useDragOrder } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { type Folds, useFolds, useReveal } from "../fold";
import { type RowProps, rowElement, rowId, rowLink, sameSessions, sessionsByPullRequest } from "./pr-row";

// Both keys keep their names from before the page was called Pull requests, so the browser's saved folds and order survive.
/** The repositories and sections flipped from their default fold: `owner/repo`, and `owner/repo:<section title>`. */
const FOLDS_KEY = "omp-agents.inbox-collapsed";
const ORDER_KEY = "omp-agents.inbox-order";

const SORTS = Object.keys(PULL_REQUEST_SORTS) as PullRequestSort[];

/** The pull request list's order, which every list of it shares and the browser keeps. */
export const usePullRequestsOrder = () => useStoredState(ORDER_KEY, decodeOrder, JSON.stringify);

/** The pull request list's folds, which the page and the sidebar share and the browser keeps. */
export const usePullRequestsFolds = (): Folds => useFolds(FOLDS_KEY, foldedByDefault);

/** `order` with the repository `key` put on the `where` side of `beside`; the repositories a list does not show, `shown` being those it does, keep their place behind them. */
export const withRepoMoved = (order: PullRequestOrder, shown: string[], key: string, beside: string, where: Where): PullRequestOrder => ({
	...order,
	repos: moveKey([...shown, ...order.repos.filter(other => !shown.includes(other))], key, beside, where),
});

/** Moves a focused heading or row one place; `false` at the edge. */
type Move = (by: 1 | -1) => boolean;

/** The fold keys of the repository and the section that list `pr`, or `null` when `list` leaves it out. */
function placeOf(list: PullRequestList, pr: PullRequest, agent: AgentOn): { repo: string; section: string } | null {
	for (const repo of list.repos) {
		if ("error" in repo) continue;
		const section = pullRequestSections(repo.pullRequests, DEFAULT_ORDER, agent).find(({ rows }) => rows.some(row => samePullRequest(row.pr, pr)));
		const key = repoKey(repo);
		if (section) return { repo: key, section: sectionFoldKey(key, section.title) };
	}
	return null;
}

/**
 * ↓ and ↑ move between the rows `shown` lists, or, while the main area shows a pull request's details, show the next or
 * previous one; on its changes page they step through its files instead. With no row focused they enter the list only
 * when `entersList`, so the sidebar's list leaves them to scroll the panes. O opens the pull request on GitHub, `.` opens
 * a row's quick actions, and E runs `giveToAgent` on the focused row's pull request, or the one the main area shows. A
 * key that has nothing to act on keeps its usual meaning.
 */
function useTriageKeys(shown: PullRequestSummary[], route: PullRequestsRoute, entersList: boolean, giveToAgent: (pr: PullRequest) => boolean, openActions: (pr: PullRequestSummary) => boolean): void {
	const { target } = route;
	const current = (): number =>
		target ? shown.findIndex(pr => samePullRequest(pr, target)) : shown.findIndex(pr => rowElement(pr)?.contains(document.activeElement) ?? false);
	const step = (by: 1 | -1): boolean => {
		if (route.target !== null && route.files !== null) return false;
		const at = current();
		if (target) {
			if (at < 0) return false;
			const next = shown[at + by];
			if (next) location.hash = hashForPullRequests(next);
			return true;
		}
		const next = at >= 0 ? shown[at + by] : entersList ? shown[by === 1 ? 0 : shown.length - 1] : undefined;
		const row = next && rowElement(next);
		if (!next || !row) return at >= 0;
		rowLink(next)?.focus({ preventScroll: true });
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
			return pr ? openActions(pr) : false;
		},
		giveToAgent: () => {
			const pr = target ?? shown[current()];
			return pr ? giveToAgent(pr) : false;
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

export function SortMenu({ order, onSort, onReset }: { order: PullRequestOrder; onSort: (sort: PullRequestSort) => void; onReset: () => void }) {
	const [open, setOpen] = useState(false);
	const label = `Sort: ${PULL_REQUEST_SORTS[order.sort]}`;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`${label}. Change the pull requests' order`} />}>
					<ArrowDownUp />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-52">
				<MenuRadioGroup value={order.sort} onValueChange={(sort: PullRequestSort) => onSort(sort)}>
					{SORTS.map(sort => (
						<MenuRadioItem key={sort} value={sort} closeOnClick>
							{PULL_REQUEST_SORTS[sort]}
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

/** The workspace a repository's heading names after it: a lone workspace whose folder is not the repository's name, or how many there are. */
export function workspacesLabel({ repo, cwds }: RepoPullRequests): string | null {
	if (cwds.length !== 1) return `${cwds.length} workspaces`;
	const folder = folderName(cwds[0]!);
	return folder && folder.toLowerCase() !== repo.toLowerCase() ? folder : null;
}

/** The workspaces the pull request list leaves out, having no GitHub `origin`, as an icon that lists them on hover; nothing when it leaves none out. */
export function UnmatchedTip({ unmatched }: { unmatched: string[] }) {
	if (unmatched.length === 0) return null;
	const label = `${unmatched.length === 1 ? "1 workspace has no GitHub origin and is" : `${unmatched.length} workspaces have no GitHub origin and are`} left out`;
	return (
		<Tooltip content={`${label}:\n${unmatched.join("\n")}`}>
			<span role="img" aria-label={label} className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
				<Unplug aria-hidden className="size-3.5" />
			</span>
		</Tooltip>
	);
}

/** What moves a repository or section: a drag, or Alt+Shift+↑ and ↓. */
interface Placed {
	drag: DragItem;
	/** What `data-move` names it by. */
	moveId: string;
}

/** The Pull requests page's card for the section `title` of the repository `repo`, which a sidebar link scrolls to. */
export const pullRequestSectionTarget = (repo: string, title: MoveGroup): SectionTarget => ({ id: sectionId("pull-requests-section", repo, title), folds: [repo, sectionFoldKey(repo, title)] });

export interface SectionView extends Placed {
	section: PullRequestSection;
	foldKey: string;
	/** The id of its list, which its fold button controls. */
	listId: string;
	open: boolean;
	toggle: () => void;
	/** Its moves summed up while folded, such as `2 in review · 1 CI running`; `null` while open or for a section of one move. */
	summary: string | null;
	rows: RowProps[];
}

export interface RepoView extends Placed {
	repo: RepoPullRequests;
	key: string;
	/** `owner/repo`. */
	name: string;
	/** The id of its body, which its fold button controls. */
	bodyId: string;
	open: boolean;
	toggle: () => void;
	sections: SectionView[];
}

export interface PullRequestsBoard {
	poll: PolledEntry<PullRequestList>;
	refresh: () => void;
	order: PullRequestOrder;
	onSort: (sort: PullRequestSort) => void;
	onReset: () => void;
	folds: Folds;
	repos: RepoView[];
}

interface BoardProps {
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** What the main area shows: a pull request's row unfolds, scrolls into view, and stays highlighted while its details or changes show. */
	route: PullRequestsRoute;
	/** Whether ↓ and ↑ with no row focused enter the list: the page's do, the sidebar's leave them to scroll the panes. */
	entersList: boolean;
}

/** What makes an item's drag: the arguments of `useDragOrder`'s function, which change with every drag and so are called in a pass of their own. */
interface Dropped {
	scope: string;
	key: string;
	onDrop: (dragged: string, where: Where) => void;
}

/** A row's place on the board, which changes only with the pull request list, its order, and its folds. */
interface RowLayout {
	row: SectionRow;
	key: string;
	cwd: string;
	moveId: string;
	dropped: Dropped;
	/** The units of the rows above and below it; a stack takes a drop as one, so the line shows above its top row or under its bottom one. */
	above: string | null;
	below: string | null;
}

type SectionLayout = Omit<SectionView, "drag" | "rows"> & { dropped: Dropped; rows: RowLayout[] };

type RepoLayout = Omit<RepoView, "drag" | "sections"> & { dropped: Dropped; sections: SectionLayout[] };

const NO_SESSIONS: RowProps["sessions"] = [];

/**
 * The sessions on each pull request, by `prKey`, keeping the list of one whose sessions draw the same chips as the same
 * array, so a roster update redraws only the rows whose sessions changed.
 */
function useSessionsByPullRequest(hosts: RosterHost[], past: PastSession[]): ReadonlyMap<string, RowProps["sessions"]> {
	const previous = useRef<ReadonlyMap<string, RowProps["sessions"]>>(new Map());
	return useMemo(() => {
		const next = sessionsByPullRequest(hosts, past);
		for (const [key, links] of next) {
			const before = previous.current.get(key);
			if (before && sameSessions(before, links)) next.set(key, before);
		}
		previous.current = next;
		return next;
	}, [hosts, past]);
}

/**
 * The pull requests of `workspace` as a board of repositories, sections, and rows, with the keys that move through it. Dragging
 * or Alt+Shift+↑ and ↓ reorder the repositories, the sections, and the pull requests in a section; the browser keeps
 * the order. Mount it once per screen, since its keys act on the rows it lists.
 */
export function usePullRequestsBoard({ workspace, hosts, past, route, entersList }: BoardProps): PullRequestsBoard {
	const { target } = route;
	const targetKey = target ? prKey(target) : null;
	const { open, start } = useDashboardActions();
	const { starts: { quick } } = useDashboardStatus();
	const poll = pullRequestsStore.use(workspace);
	const { read } = poll;
	const list = read?.data ?? null;
	const folds = usePullRequestsFolds();
	const [order, setOrder] = usePullRequestsOrder();
	const drag = useDragOrder();
	const agent = useMemo(() => agentOn(hosts), [hosts]);
	const place = useMemo(() => (list && target ? placeOf(list, target, agent) : null), [list, targetKey, agent]);
	const reveal = target && place ? { id: rowId(target), folds: [place.repo, place.section] } : null;
	useReveal(reveal, folds, { token: reveal?.id, block: "nearest", focus: false });
	/** Starts the quick action that makes `pr`'s move, the one its row's menu would; `false` when no action makes it. */
	const giveToAgent = (pr: PullRequest): boolean => {
		const listed = list && listedPullRequest(list, pr);
		const action = listed && moveAction(listed.pr, moveOf(listed.pr, agent(listed.pr)));
		if (!listed || !action) return false;
		start(pullRequestStart(listed.pr, action, listed.cwd, readPinnedSkill()));
		return true;
	};
	/** The row, by {@link rowId}, whose quick actions menu is open. */
	const [actionsOpen, setActionsOpen] = useState<string | null>(null);
	const openActions = (pr: PullRequestSummary): boolean => {
		if (pullRequestActions(pr).length === 0) return false;
		setActionsOpen(rowId(pr));
		return true;
	};
	// The functions every row shares, so a row's props change only with what the row shows.
	const onQuickAction = useCallback((pr: PullRequestSummary, cwd: string, action: PullRequestActionId) => start(pullRequestStart(pr, action, cwd, readPinnedSkill())), [start]);
	const onActionsOpenChange = useCallback((pr: PullRequest, next: boolean) => setActionsOpen(next ? rowId(pr) : null), []);
	const shown = useMemo(() => (list ? shownPullRequests(list, folds.isFolded, order, agent) : []), [list, folds.isFolded, order, agent]);
	useTriageKeys(shown, route, entersList, giveToAgent, openActions);

	const repos = useMemo(() => (list ? orderedRepos(list.repos, order) : []), [list, order]);
	const sectionsOf = useMemo(() => repos.map(repo => ("error" in repo ? [] : pullRequestSections(repo.pullRequests, order, agent))), [repos, order, agent]);
	// The page shows its pull requests in this order now; placing one by hand starts the manual sort from it.
	const shownOrder = useMemo(
		() => (order.sort === "manual" && order.manual.length > 0 ? order.manual : sectionsOf.flatMap(sections => sections.flatMap(({ rows }) => rows.map(row => prKey(row.pr))))),
		[order, sectionsOf],
	);
	const layout = useMemo(() => {
		const moves = new Map<string, Move>();
		const repoKeys = repos.map(repoKey);
		const moveRepo = (key: string, beside: string, where: Where): void => setOrder(withRepoMoved(order, repoKeys, key, beside, where));
		const moveSection = (title: string, beside: string, where: Where): void => setOrder({ ...order, sections: moveKey(sectionTitles(order), title, beside, where) });

		const repoLayout = (repo: RepoPullRequests, at: number): RepoLayout => {
			const key = repoKey(repo);
			const moveId = `repo:${key}`;
			moves.set(moveId, by => {
				const step = stepTarget(repoKeys, key, by);
				if (step) moveRepo(key, step.target, step.where);
				return step !== null;
			});
			const sections = sectionsOf[at]!;
			const titles = sections.map(({ title }) => title);
			return {
				repo,
				key,
				name: `${repo.owner}/${repo.repo}`,
				bodyId: sectionId("pull-requests", key),
				open: !folds.isFolded(key),
				toggle: () => folds.toggle(key),
				dropped: { scope: "repos", key, onDrop: (dragged, where) => moveRepo(dragged, key, where) },
				moveId,
				sections: sections.map((section): SectionLayout => {
					const foldKey = sectionFoldKey(key, section.title);
					const sectionOpen = !folds.isFolded(foldKey);
					const sectionMoveId = `section:${foldKey}`;
					moves.set(sectionMoveId, by => {
						const step = stepTarget(titles, section.title, by);
						if (step) moveSection(section.title, step.target, step.where);
						return step !== null;
					});
					const units = [...new Set(section.rows.map(({ unit }) => unit))];
					const placeUnit = (unit: string, beside: string, where: Where): void =>
						setOrder({ ...order, sort: "manual", manual: placedManual(shownOrder, repo, sections, section.title, unit, beside, where) });
					return {
						section,
						foldKey,
						listId: sectionId("pull-requests", key, section.title),
						open: sectionOpen,
						toggle: () => folds.toggle(foldKey),
						summary: sectionOpen ? null : movesSummary(section),
						dropped: { scope: `sections:${key}`, key: section.title, onDrop: (dragged, where) => moveSection(dragged, section.title, where) },
						moveId: sectionMoveId,
						rows: section.rows.map((row, at): RowLayout => {
							const rowKey = prKey(row.pr);
							const rowMoveId = `pull-request:${rowKey}`;
							moves.set(rowMoveId, by => {
								const step = stepTarget(units, row.unit, by);
								if (step) placeUnit(row.unit, step.target, step.where);
								return step !== null;
							});
							return {
								row,
								key: rowKey,
								cwd: repo.cwds[0]!,
								moveId: rowMoveId,
								dropped: { scope: `pull-requests:${foldKey}`, key: row.unit, onDrop: (dragged, where) => placeUnit(dragged, row.unit, where) },
								above: section.rows[at - 1]?.unit ?? null,
								below: section.rows[at + 1]?.unit ?? null,
							};
						}),
					};
				}),
			};
		};
		return { repos: repos.map(repoLayout), moves };
	}, [repos, sectionsOf, shownOrder, order, setOrder, folds]);
	useMoveKeys(layout.moves);

	const sessions = useSessionsByPullRequest(hosts, past);
	// What changes with a drag, the roster, the target, a pending start, or an open menu: a cheap pass over the layout.
	const views = useMemo(() => {
		const place = ({ scope, key, onDrop }: Dropped): DragItem => drag(scope, key, onDrop);
		return layout.repos.map(({ dropped, sections, ...repo }): RepoView => ({
			...repo,
			drag: place(dropped),
			sections: sections.map(({ dropped, rows, ...section }): SectionView => ({
				...section,
				drag: place(dropped),
				rows: rows.map(({ row, key, cwd, moveId, dropped, above, below }): RowProps => {
					const item = place(dropped);
					const edge = item.dropAt === "before" ? above : below;
					return {
						row,
						sessions: sessions.get(key) ?? NO_SESSIONS,
						targeted: key === targetKey,
						onOpen: open,
						pending: pendingOf(quick, { kind: "pull-request", pr: row.pr }),
						cwd,
						onQuickAction,
						actionsOpen: actionsOpen === rowId(row.pr),
						onActionsOpenChange,
						drag: { ...item, dropAt: edge === row.unit ? null : item.dropAt },
						moveId,
					};
				}),
			})),
		}));
	}, [layout, drag, sessions, targetKey, open, quick, actionsOpen, onQuickAction, onActionsOpenChange]);

	return {
		poll,
		refresh: () => void pullRequestsStore.refresh(workspace, { fresh: true }),
		order,
		onSort: sort => setOrder({ ...order, sort, manual: sort === "manual" ? shownOrder : order.manual }),
		onReset: () => setOrder(DEFAULT_ORDER),
		folds,
		repos: views,
	};
}
