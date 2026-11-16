/** What the Pull requests page's list and its details page share: the pull requests' state, their keys, and the list's repositories, sections, and rows. */
import { IconArrowBottomTop, IconCloudSimpleDisconnected } from "central-icons";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PullRequestActionId } from "../../../src/pull-request-actions";
import { type PullRequestList, type PullRequestSummary, type PullRequest, prKey, pullRequestUrl, type RepoPullRequests, repoKey, repoName, samePullRequest } from "../../../src/shared/github";
import { type AgentOn, agentOn, moveOf } from "../../../src/shared/moves";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	DEFAULT_ORDER,
	PULL_REQUEST_SORTS,
	type ListChange,
	type PullRequestOrder,
	type SectionRow,
	type PullRequestSection,
	type PullRequestSort,
	listedPullRequest,
	moveAction,
	movesSummary,
	orderedRepos,
	placedManual,
	sectionFoldKey,
	sectionsOfRepos,
	rebaseOrder,
	sectionTitles,
	shownPullRequests,
	withRepoMoved,
	withRepoStepped,
} from "../../pull-requests-model";
import { useHiddenRepos, usePullRequestsFolds, usePullRequestsOrder } from "../../pull-requests-state";
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
import { type DragItem, useDragOrder } from "../../use-drag-order";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { useReveal } from "../fold";
import { stepRows } from "../list-page";
import { type RowBase, type RowProps, rowElement, rowId, sameSessions, sessionsByPullRequest } from "./pr-row";

const SORTS = Object.keys(PULL_REQUEST_SORTS) as PullRequestSort[];

/** Moves a focused heading or row one place; `false` at the edge. */
type Move = (by: 1 | -1) => boolean;

/** The fold keys of the repository and the section that list `pr`, or `null` when `repos` leaves it out; `sectionsOf` holds each repository's sections at the same index. */
function placeOf(repos: readonly RepoPullRequests[], sectionsOf: readonly PullRequestSection[][], pr: PullRequest): { repo: string; section: string } | null {
	for (const [at, repo] of repos.entries()) {
		const section = sectionsOf[at]!.find(({ rows }) => rows.some(row => samePullRequest(row.pr, pr)));
		if (!section) continue;
		const key = repoKey(repo);
		return { repo: key, section: sectionFoldKey(key, section.title) };
	}
	return null;
}

/**
 * Binds the keys of a screen of `pulls`, over the pull requests it shows in order, less those of the repositories and
 * sections `isFolded` folds. Mount it once per screen, since its keys are global. ↓ and ↑ move between those rows, or,
 * while the main area shows a pull request's details, show the next or previous one; on its changes page they step
 * through its files instead. O opens the pull request on GitHub, `.` opens a row's `⋯` menu, and E starts the quick
 * action that makes the move of the focused row's pull request, or the one the main area shows, the one its row's menu
 * would, even in a repository you hid. A key that has nothing to act on keeps its usual meaning.
 */
export function usePullRequestKeys({ poll, repos, sectionsOf, agent, route, onActionsOpenChange }: PullRequests, isFolded: (key: string) => boolean): void {
	const { start } = useDashboardActions();
	const { target } = route;
	const shown = useMemo(() => shownPullRequests(repos, sectionsOf, isFolded), [repos, sectionsOf, isFolded]);
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
		start(pullRequestStart(listed.pr, action, listed.cwd, readPinnedSkill()));
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

export function SortMenu({ order, onSort, onReset }: { order: PullRequestOrder; onSort: (sort: PullRequestSort) => void; onReset: () => void }) {
	const [open, setOpen] = useState(false);
	const label = `Sort: ${PULL_REQUEST_SORTS[order.sort]}`;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`${label}. Change the pull requests' order`} />}>
					<IconArrowBottomTop />
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

/** What moves a repository or section: a drag, or Alt+Shift+↑ and ↓. */
interface Placed {
	drag: DragItem;
	/** What `data-move` names it by. */
	moveId: string;
}

export interface SectionView extends Placed {
	section: PullRequestSection;
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
	/** The repositories you did not hide, in the list's order, and the sections of each, at the same index. */
	repos: RepoPullRequests[];
	sectionsOf: PullRequestSection[][];
	/** Every repository in the list's order, those you hid too. */
	everyRepo: RepoPullRequests[];
	/** Every pull request's key in the order the list shows them now; placing one by hand starts the manual sort from it. */
	shownOrder: string[];
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
}

/** What makes an item's drag: the arguments of `useDragOrder`'s function, which change with every drag and so are called in a pass of their own. */
interface Dropped {
	scope: string;
	key: string;
	onDrop: (dragged: string, where: Where) => void;
}

/** A row's place in the list, which changes only with the pull request list, its order, and its folds. */
interface RowLayout {
	row: SectionRow;
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

/** The pull requests of the sidebar's scope, with the state and the functions that the list and the details page share. */
export function usePullRequests({ hosts, past, route }: PullRequestsProps): PullRequests {
	const targetKey = route.target ? prKey(route.target) : null;
	const { open, start } = useDashboardActions();
	const { starts: { quick }, pullRequestsScope: scope } = useDashboardStatus();
	const poll = pullRequestsStore.use(scope);
	const read = poll.read?.data ?? null;
	const [hidden] = useHiddenRepos();
	const [order, setOrder] = usePullRequestsOrder();
	const agent = useMemo(() => agentOn(hosts), [hosts]);
	const sessions = useSessionsByPullRequest(hosts, past);
	/** The row, by {@link rowId}, whose `⋯` menu is open. */
	const [actionsOpen, setActionsOpen] = useState<string | null>(null);
	const onQuickAction = useCallback((pr: PullRequestSummary, cwd: string, action: PullRequestActionId) => start(pullRequestStart(pr, action, cwd, readPinnedSkill())), [start]);
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
	const sectionsOf = useMemo(() => sectionsOfRepos(repos, order, agent), [repos, order, agent]);
	const behind = useMemo(
		() =>
			repos.flatMap((repo): RebaseJob[] => {
				if ("error" in repo) return [];
				const cwd = repo.cwds[0];
				return cwd === undefined ? [] : rebaseOrder(repo.pullRequests).map(pr => ({ pr, cwd }));
			}),
		[repos],
	);
	const shownOrder = useMemo(
		() => (order.sort === "manual" && order.manual.length > 0 ? order.manual : sectionsOf.flatMap(sections => sections.flatMap(({ rows }) => rows.map(row => prKey(row.pr))))),
		[order, sectionsOf],
	);
	return {
		poll,
		refresh,
		route,
		agent,
		order,
		setOrder,
		onSort: sort => setOrder({ ...order, sort, manual: sort === "manual" ? shownOrder : order.manual }),
		onReset: () => setOrder(DEFAULT_ORDER),
		repos,
		sectionsOf,
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
 * The list of `pulls`: its repositories, sections, and rows, with their folds and the keys that move through them.
 * Dragging or Alt+Shift+↑ and ↓ reorder its repositories, sections, and the pull requests in a section; a hidden
 * repository keeps its place. The browser keeps the order. Mount it once per screen, since its keys act on the rows it
 * lists.
 */
export function usePullRequestsList(pulls: PullRequests): RepoView[] {
	const { route: { target }, order, setOrder, repos, sectionsOf, everyRepo, shownOrder, rowBase } = pulls;
	const targetKey = target ? prKey(target) : null;
	const folds = usePullRequestsFolds();
	const drag = useDragOrder();
	const place = useMemo(() => (target ? placeOf(repos, sectionsOf, target) : null), [repos, sectionsOf, targetKey]);
	const reveal = target && place ? { id: rowId(target), folds: [place.repo, place.section] } : null;
	useReveal(reveal, folds, { token: reveal?.id, block: "nearest", focus: false });
	usePullRequestKeys(pulls, folds.isFolded);

	const layout = useMemo(() => {
		const moves = new Map<string, Move>();
		const repoKeys = repos.map(repoKey);
		const everyKey = everyRepo.map(repoKey);
		const moveRepo = (key: string, beside: string, where: Where): void => setOrder(withRepoMoved(order, everyKey, key, beside, where));
		const moveSection = (title: string, beside: string, where: Where): void => setOrder({ ...order, sections: moveKey(sectionTitles(order), title, beside, where) });

		const repoLayout = (repo: RepoPullRequests, at: number): RepoLayout => {
			const key = repoKey(repo);
			const moveId = `repo:${key}`;
			moves.set(moveId, by => {
				const next = withRepoStepped(order, everyKey, repoKeys, key, by);
				if (next) setOrder(next);
				return next !== null;
			});
			const sections = sectionsOf[at]!;
			const titles = sections.map(({ title }) => title);
			return {
				repo,
				key,
				name: repoName(repo),
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
	}, [repos, sectionsOf, everyRepo, shownOrder, order, setOrder, folds]);
	useMoveKeys(layout.moves);

	// What changes with a drag, the roster, the target, a pending start, or an open menu: a cheap pass over the layout.
	return useMemo(() => {
		const place = ({ scope, key, onDrop }: Dropped): DragItem => drag(scope, key, onDrop);
		return layout.repos.map(({ dropped, sections, ...repo }): RepoView => ({
			...repo,
			drag: place(dropped),
			sections: sections.map(({ dropped, rows, ...section }): SectionView => ({
				...section,
				drag: place(dropped),
				rows: rows.map(({ row, cwd, moveId, dropped, above, below }): RowProps => {
					const item = place(dropped);
					const edge = item.dropAt === "before" ? above : below;
					return { ...rowBase(row, cwd), drag: { ...item, dropAt: edge === row.unit ? null : item.dropAt }, moveId };
				}),
			})),
		}));
	}, [layout, drag, rowBase]);
}
