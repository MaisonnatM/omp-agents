/** What the Pull requests page's list and its details page share: the pull requests' state, their keys, and the list's headings, tables, and rows. */
import { IconCloudSimpleDisconnected } from "central-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PullRequestActionId } from "../../../src/pull-request-actions";
import { type PullRequestList, type PullRequestSummary, type PullRequest, prKey, pullRequestUrl, type RepoPullRequests, repoKey, samePullRequest } from "../../../src/shared/github";
import { type AgentOn, agentOn, moveOf } from "../../../src/shared/moves";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	DEFAULT_ORDER,
	type ListChange,
	type MoveGroup,
	type PullRequestOrder,
	type SectionRow,
	type PullRequestSort,
	fixOwner,
	listedPullRequest,
	moveAction,
	movesSummary,
	orderedRepos,
	placedManual,
	sectionsOfRepos,
	rebaseOrder,
	sectionTitles,
	withRepoMoved,
	withRepoStepped,
} from "../../pull-requests-model";
import { cardFoldKey, filteredList, groupedList, groupFoldKey, type ListGroup, type PullRequestDisplay, type PullRequestGrouping, shownPullRequests } from "../../pull-requests-filter";
import { useHiddenRepos, usePullRequestsDisplay, usePullRequestsFilter, usePullRequestsFolds, usePullRequestsOrder } from "../../pull-requests-state";
import { moveKey, stepTarget, type Where } from "../../order";
import { folderName } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { pendingOf, pullRequestStart } from "../../quick-actions";
import { type RebaseHooks, type RebaseJob, rebasePullRequest, rebasePullRequests } from "../../pull-request-rebases";
import type { PolledEntry } from "../../polled-store";
import { pullRequestsStore, writePullRequest } from "../../reads";
import { hashForPullRequests, type PullRequestsRoute } from "../../routing";
import { sectionId } from "../../section";
import { useShortcuts } from "../../shortcuts";
import { type DragItem, NO_DRAG, useDragOrder } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { useReveal } from "../fold";
import { stepRows } from "../list-page";
import { type RowBase, type RowProps, rowElement, rowId, sameSessions, sessionsByPullRequest } from "./pr-row";

/** Moves a focused heading or row one place; `false` at the edge. */
type Move = (by: 1 | -1) => boolean;

/** The fold keys of the heading and the table that list `pr` under `grouping`, or `null` when `groups` leaves it out. */
function foldsOf(grouping: PullRequestGrouping, groups: readonly ListGroup[], pr: PullRequest): string[] | null {
	for (const group of groups) {
		const card = group.cards.find(({ rows }) => rows.some(({ row }) => samePullRequest(row.pr, pr)));
		if (!card) continue;
		const key = groupFoldKey(grouping, group.key);
		return [key, cardFoldKey(key, card.key)];
	}
	return null;
}

/**
 * Binds the keys of a screen of `pulls`, over the pull requests it shows in order, less those of the headings and
 * tables `isFolded` folds. Mount it once per screen, since its keys are global. ↓ and ↑ move between those rows, or,
 * while the main area shows a pull request's details, show the next or previous one; on its changes page they step
 * through its files instead. O opens the pull request on GitHub, `.` opens a row's `⋯` menu, and E starts the quick
 * action that makes the move of the focused row's pull request, or the one the main area shows, the one its row's menu
 * would, even in a repository you hid. A key that has nothing to act on keeps its usual meaning.
 */
export function usePullRequestKeys({ poll, groups, display, agent, route, onActionsOpenChange, onQuickAction }: PullRequests, isFolded: (key: string) => boolean): void {
	const { target } = route;
	const shown = useMemo(() => shownPullRequests(display.grouping, groups, isFolded), [display.grouping, groups, isFolded]);
	const current = (): number =>
		target ? shown.findIndex(pr => samePullRequest(pr, target)) : shown.findIndex(pr => rowElement(pr)?.contains(document.activeElement) ?? false);
	const step = (by: 1 | -1): boolean => {
		if (route.target !== null && route.files !== null) return false;
		if (target) {
			const at = current();
			if (at < 0) return false;
			const next = shown[at + by];
			if (next) location.hash = hashForPullRequests(next);
			return true;
		}
		return stepRows(shown, pr => rowElement(pr), by);
	};
	const giveToAgent = (pr: PullRequest): boolean => {
		const read = poll.read?.data;
		const listed = read && listedPullRequest(read, pr);
		const action = listed && moveAction(listed.pr, moveOf(listed.pr, agent(listed.pr)));
		if (!listed || !action) return false;
		onQuickAction(listed.pr, listed.cwd, action);
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
			if (!pr) return false;
			onActionsOpenChange(pr, true);
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

/** The workspace a repository's heading names after it: a lone workspace whose folder is not the repository's name, or how many there are. */
export function workspacesLabel({ repo, cwds }: RepoPullRequests): string | null {
	if (cwds.length !== 1) return `${cwds.length} workspaces`;
	const folder = folderName(cwds[0]!);
	return folder && folder.toLowerCase() !== repo.toLowerCase() ? folder : null;
}

/** Why GitHub could not read the repository `name`, which takes the place of its pull requests. */
export function RepoReadError({ name, error, className }: { name: string; error: string; className?: string }) {
	return (
		<p role="alert" className={cn("text-red-600 dark:text-red-400", className)}>
			Cannot read {name} from GitHub: {error}
		</p>
	);
}

/** The workspaces the pull request list leaves out, having no GitHub `origin`, as an icon that lists them on hover; nothing when it leaves none out. */
export function UnmatchedTip({ unmatched }: { unmatched: string[] }) {
	if (unmatched.length === 0) return null;
	const label = `${unmatched.length === 1 ? "1 workspace has no GitHub origin and is" : `${unmatched.length} workspaces have no GitHub origin and are`} left out`;
	return (
		<Tooltip content={`${label}:\n${unmatched.join("\n")}`}>
			<span role="img" aria-label={label} className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
				<IconCloudSimpleDisconnected className="size-3.5" />
			</span>
		</Tooltip>
	);
}

/**
 * What moves a heading, a table, or a row: a drag, and Alt+Shift+↑ and ↓ by its `data-move`. Only the grouping by
 * repository keeps an order of its own, so under the others it is {@link NO_DRAG} with no id.
 */
interface Placed {
	drag: DragItem;
	/** What `data-move` names it by; `undefined` where it does not move. */
	moveId: string | undefined;
}

/** A table under a heading, with its fold. */
export interface TableView extends Placed {
	key: string;
	title: string;
	/** The section it lists, whose count **Your move** draws stronger; `null` for the one table of no grouping. */
	section: MoveGroup | null;
	/** The id of its list, which its fold button controls. */
	listId: string;
	open: boolean;
	toggle: () => void;
	/** Its moves summed up while folded, such as `2 in review · 1 CI running`; `null` while open, under a grouping other than by repository, or for a section of one move. */
	summary: string | null;
	rows: RowProps[];
}

/** A heading of the list, with its fold and its tables. */
export interface GroupView extends Placed {
	key: string;
	/** `null` under no grouping, whose one table has no heading. */
	title: string | null;
	/** The repository it lists under the grouping by repository. */
	repo: RepoPullRequests | null;
	/** The id of its body, which its fold button controls. */
	bodyId: string;
	open: boolean;
	toggle: () => void;
	tables: TableView[];
}

/** The pull requests of a workspace, read from GitHub, and what the list and the details page share. */
export interface PullRequests {
	poll: PolledEntry<PullRequestList>;
	refresh: () => void;
	/** What the main area shows: its pull request's row stays highlighted while its details or changes show. */
	route: PullRequestsRoute;
	agent: AgentOn;
	order: PullRequestOrder;
	setOrder: (order: PullRequestOrder) => void;
	onSort: (sort: PullRequestSort) => void;
	onReset: () => void;
	/** The list's headings and tables: what the tab, **Filter**, and the search keep, under **Display**'s grouping. */
	groups: ListGroup[];
	display: PullRequestDisplay;
	/** Every repository in the list's order, those you hid too. */
	everyRepo: RepoPullRequests[];
	/** Every pull request's key in the order the list shows them now, filtered ones too; placing one by hand starts the manual sort from it. */
	shownOrder: () => string[];
	/** What a list row of `row` takes, from functions every row shares, so a row's props change only with what it shows. */
	rowBase: (row: SectionRow, cwd: string) => RowBase;
	onQuickAction: RowBase["onQuickAction"];
	onRebase: RowBase["onRebase"];
	/** What **Rebase behind** rebases, in order, each from its repository's first workspace. */
	behind: RebaseJob[];
	onRebaseBehind: () => void;
	onActionsOpenChange: RowBase["onActionsOpenChange"];
	onChange: RowBase["onChange"];
}

interface PullRequestsProps {
	hosts: RosterHost[];
	past: PastSession[];
	/** What the main area shows: a pull request's row unfolds, scrolls into view, and stays highlighted while its details or changes show. */
	route: PullRequestsRoute;
	/** What the search field holds; empty or left out matches every pull request, so the details page, which has no search, steps through the filtered list. */
	query?: string;
}

/** What makes an item's drag: the arguments of `useDragOrder`'s function, which change with every drag and so are called in a pass of their own. */
interface Dropped {
	scope: string;
	key: string;
	onDrop: (dragged: string, where: Where) => void;
}

/** How an item of the layout moves: its drag's arguments and its move id, or neither. */
interface Placement {
	dropped: Dropped | null;
	moveId: string | undefined;
}

const STILL: Placement = { dropped: null, moveId: undefined };

/** A row's place in the list, which changes only with the pull request list, its order, and its folds. */
interface RowLayout extends Placement {
	row: SectionRow;
	cwd: string;
	/** The units of the rows above and below it; a stack takes a drop as one, so the line shows above its top row or under its bottom one. */
	above: string | null;
	below: string | null;
}

type TableLayout = Omit<TableView, "drag" | "rows"> & Placement & { rows: RowLayout[] };

type GroupLayout = Omit<GroupView, "drag" | "tables"> & Placement & { tables: TableLayout[] };

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

/** The pull requests of the sidebar's scope, with the state and the functions that the list and the details page share. */
export function usePullRequests({ hosts, past, route, query = "" }: PullRequestsProps): PullRequests {
	const targetKey = route.target ? prKey(route.target) : null;
	const { open, start } = useDashboardActions();
	const { starts: { quick }, pullRequestsScope: scope } = useDashboardStatus();
	const poll = pullRequestsStore.use(scope);
	const read = poll.read?.data ?? null;
	const [hidden] = useHiddenRepos();
	const shownBefore = useRef(hidden);
	// A hidden repository is never read, so showing one again reads the list for it.
	useEffect(() => {
		const unhid = [...shownBefore.current].some(key => !hidden.has(key));
		shownBefore.current = hidden;
		if (unhid) void pullRequestsStore.refresh(scope);
	}, [hidden, scope]);
	const [filter] = usePullRequestsFilter();
	const [display] = usePullRequestsDisplay();
	const [order, setOrder] = usePullRequestsOrder();
	const agent = useMemo(() => agentOn(hosts), [hosts]);
	const sessions = useSessionsByPullRequest(hosts, past);
	/** The row, by {@link rowId}, whose `⋯` menu is open. */
	const [actionsOpen, setActionsOpen] = useState<string | null>(null);
	// Read through a ref, so the function stays the same for every row while the roster changes.
	const sessionsNow = useRef(sessions);
	sessionsNow.current = sessions;
	const onQuickAction = useCallback(
		(pr: PullRequestSummary, cwd: string, action: PullRequestActionId) => start(pullRequestStart(pr, action, cwd, readPinnedSkill(), fixOwner(sessionsNow.current.get(prKey(pr)) ?? NO_SESSIONS, action)?.sessionId ?? null)),
		[start],
	);
	const refresh = useCallback(() => void pullRequestsStore.refresh(scope, { fresh: true }), [scope]);
	const rebaseHooks = useMemo((): RebaseHooks => ({ resolve: ({ pr, cwd }) => onQuickAction(pr, cwd, "resolve-conflicts"), refresh }), [onQuickAction, refresh]);
	const onRebase = useCallback((pr: PullRequestSummary, cwd: string) => rebasePullRequest({ pr, cwd }, rebaseHooks), [rebaseHooks]);
	const onActionsOpenChange = useCallback((pr: PullRequest, next: boolean) => setActionsOpen(next ? rowId(pr) : null), []);
	const onChange = useCallback(
		async (pr: PullRequestSummary, change: ListChange) => {
			await writePullRequest(scope, pr, change);
		},
		[scope],
	);
	const rowBase = useCallback(
		(row: SectionRow, cwd: string): RowBase => {
			const key = prKey(row.pr);
			return {
				row,
				sessions: sessions.get(key) ?? NO_SESSIONS,
				targeted: key === targetKey,
				onOpen: open,
				pending: pendingOf(quick, { kind: "pull-request", pr: row.pr }),
				cwd,
				onQuickAction,
				onRebase,
				actionsOpen: actionsOpen === rowId(row.pr),
				onActionsOpenChange,
				onChange,
			};
		},
		[sessions, targetKey, open, quick, actionsOpen, onQuickAction, onRebase, onActionsOpenChange, onChange],
	);
	const everyRepo = useMemo(() => (read ? orderedRepos(read.repos, order) : []), [read, order]);
	const repos = useMemo(() => (hidden.size === 0 ? everyRepo : everyRepo.filter(repo => !hidden.has(repoKey(repo)))), [everyRepo, hidden]);
	// Dates count back from when GitHub was read, so the list changes only with what it shows.
	const now = poll.read?.at ?? 0;
	const groups = useMemo(
		() => groupedList(display.grouping, filteredList(repos, filter, query, order, agent, display.empty, now), order),
		[display.grouping, display.empty, repos, filter, query, order, agent, now],
	);
	const behind = useMemo(
		() =>
			repos.flatMap((repo): RebaseJob[] => {
				if ("error" in repo) return [];
				const cwd = repo.cwds[0];
				return cwd === undefined ? [] : rebaseOrder(repo.pullRequests).map(pr => ({ pr, cwd }));
			}),
		[repos],
	);
	// Every section's pull requests, the filtered ones too, so a manual sort started under a filter keeps their places; built only when you place one.
	const shownOrder = useCallback(
		() => (order.sort === "manual" && order.manual.length > 0 ? order.manual : sectionsOfRepos(repos, order, agent).flatMap(sections => sections.flatMap(({ rows }) => rows.map(row => prKey(row.pr))))),
		[order, repos, agent],
	);
	return {
		poll,
		refresh,
		route,
		agent,
		order,
		setOrder,
		onSort: sort => setOrder({ ...order, sort, manual: sort === "manual" ? shownOrder() : order.manual }),
		onReset: () => setOrder(DEFAULT_ORDER),
		groups,
		display,
		everyRepo,
		shownOrder,
		rowBase,
		onQuickAction,
		onRebase,
		behind,
		onRebaseBehind: () => rebasePullRequests(behind, rebaseHooks),
		onActionsOpenChange,
		onChange,
	};
}

/**
 * The list of `pulls`: its headings, tables, and rows, with their folds and the keys that move through them. Under the
 * grouping by repository, dragging or Alt+Shift+↑ and ↓ reorder its repositories, sections, and the pull requests in a
 * section; a hidden repository keeps its place, and the browser keeps the order. The other groupings keep that order,
 * so nothing moves. Mount it once per screen, since its keys act on the rows it lists.
 */
export function usePullRequestsList(pulls: PullRequests): GroupView[] {
	const { route: { target }, display: { grouping }, order, setOrder, groups, everyRepo, shownOrder, rowBase } = pulls;
	const targetKey = target ? prKey(target) : null;
	const folds = usePullRequestsFolds();
	const drag = useDragOrder();
	const place = useMemo(() => (target ? foldsOf(grouping, groups, target) : null), [grouping, groups, targetKey]);
	const reveal = target && place ? { id: rowId(target), folds: place } : null;
	useReveal(reveal, folds, { token: reveal?.id, block: "nearest", focus: false });
	usePullRequestKeys(pulls, folds.isFolded);

	const layout = useMemo(() => {
		const moves = new Map<string, Move>();
		const movable = grouping === "repository";
		/** The move id `id`, which `step` moves a place, and the drag of `dropped`, under the grouping by repository; nothing moves under the others. */
		const placed = (id: string, step: Move, dropped: Dropped): Placement => {
			if (!movable) return STILL;
			moves.set(id, step);
			return { moveId: id, dropped };
		};
		const repoKeys = groups.map(({ key }) => key);
		const everyKey = everyRepo.map(repoKey);
		const moveRepo = (key: string, beside: string, where: Where): void => setOrder(withRepoMoved(order, everyKey, key, beside, where));
		const moveSection = (title: string, beside: string, where: Where): void => setOrder({ ...order, sections: moveKey(sectionTitles(order), title, beside, where) });

		const groupLayout = (group: ListGroup): GroupLayout => {
			const key = groupFoldKey(grouping, group.key);
			const titles = group.cards.map(card => card.key);
			return {
				key: group.key,
				title: group.title,
				repo: group.repo,
				bodyId: sectionId("pull-requests", key),
				open: !folds.isFolded(key),
				toggle: () => folds.toggle(key),
				...placed(
					`repo:${group.key}`,
					by => {
						const next = withRepoStepped(order, everyKey, repoKeys, group.key, by);
						if (next) setOrder(next);
						return next !== null;
					},
					{ scope: "repos", key: group.key, onDrop: (dragged, where) => moveRepo(dragged, group.key, where) },
				),
				tables: group.cards.map((card): TableLayout => {
					const foldKey = cardFoldKey(key, card.key);
					const open = !folds.isFolded(foldKey);
					return {
						key: card.key,
						title: card.title,
						section: card.section,
						listId: sectionId("pull-requests", foldKey),
						open,
						toggle: () => folds.toggle(foldKey),
						summary: movable && !open && card.section !== null ? movesSummary({ title: card.section, rows: card.rows.map(({ row }) => row) }) : null,
						...placed(
							`section:${foldKey}`,
							by => {
								const step = stepTarget(titles, card.key, by);
								if (step) moveSection(card.key, step.target, step.where);
								return step !== null;
							},
							{ scope: `sections:${group.key}`, key: card.key, onDrop: (dragged, where) => moveSection(dragged, card.key, where) },
						),
						rows: card.rows.map(({ row, repo, section }, at): RowLayout => {
							const placeUnit = (unit: string, beside: string, where: Where): void => {
								const sections = group.cards.flatMap(each => (each.section === null ? [] : [{ title: each.section, rows: each.rows.map(item => item.row) }]));
								setOrder({ ...order, sort: "manual", manual: placedManual(shownOrder(), repo, sections, section, unit, beside, where) });
							};
							return {
								row,
								cwd: repo.cwds[0]!,
								...placed(
									`pull-request:${prKey(row.pr)}`,
									by => {
										const step = stepTarget([...new Set(card.rows.map(item => item.row.unit))], row.unit, by);
										if (step) placeUnit(row.unit, step.target, step.where);
										return step !== null;
									},
									{ scope: `pull-requests:${foldKey}`, key: row.unit, onDrop: (dragged, where) => placeUnit(dragged, row.unit, where) },
								),
								above: card.rows[at - 1]?.row.unit ?? null,
								below: card.rows[at + 1]?.row.unit ?? null,
							};
						}),
					};
				}),
			};
		};
		return { groups: groups.map(groupLayout), moves };
	}, [grouping, groups, everyRepo, shownOrder, order, setOrder, folds]);
	useMoveKeys(layout.moves);

	// What changes with a drag, the roster, the target, a pending start, or an open menu: a cheap pass over the layout.
	return useMemo(() => {
		const dragOf = (dropped: Dropped | null): DragItem => (dropped ? drag(dropped.scope, dropped.key, dropped.onDrop) : NO_DRAG);
		return layout.groups.map(({ dropped, tables, ...group }): GroupView => ({
			...group,
			drag: dragOf(dropped),
			tables: tables.map(({ dropped, rows, ...table }): TableView => ({
				...table,
				drag: dragOf(dropped),
				rows: rows.map(({ row, cwd, moveId, dropped, above, below }): RowProps => {
					const item = dragOf(dropped);
					const edge = item.dropAt === "before" ? above : below;
					return { ...rowBase(row, cwd), drag: { ...item, dropAt: edge === row.unit ? null : item.dropAt }, moveId };
				}),
			})),
		}));
	}, [layout, drag, rowBase]);
}
