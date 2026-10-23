/** Pull request links, what each pull request waits on next, the list's sections and stacks, the board's columns and what a drop on one does, what stands between a pull request and its merge, its open review threads, and the state changes it offers. */
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, pullRequestActions } from "../src/pull-request-actions";
import { type LinkedPullRequest, type PullRequestList, type PullRequestSummary, type PullRequest, type PullRequestChange, type PullRequestDetail, type PullRequestThread, type Repo, type RepoPullRequests, prKey, repoKey, samePullRequest, type SettableState, type StackedPullRequest } from "../src/shared/github";
import { type AgentOn, hasOpenThreads, type MoveId, moveOf, readyOnceChecksPass } from "../src/shared/moves";
import type { ReviewDraft } from "../src/shared/review-drafts";

export const graphiteUrl = (pr: PullRequest): string => `https://app.graphite.com/github/pr/${pr.owner}/${pr.repo}/${pr.number}`;

/** A session's pull requests split into the stack two or more of them share, top first, and the rest; `null` when fewer than two sit in `stack`. */
export function sessionStack(pullRequests: LinkedPullRequest[], stack: StackedPullRequest[]): { stack: StackedPullRequest[]; others: LinkedPullRequest[] } | null {
	const inStack = (pr: PullRequest): boolean => stack.some(member => samePullRequest(member, pr));
	const others = pullRequests.filter(pr => !inStack(pr));
	return pullRequests.length - others.length >= 2 ? { stack, others } : null;
}

/** Whose move it is, or for your approved pull requests that need no fix, that they are approved; the list's sections, in page order. */
export type MoveGroup = "Your move" | "Agent on it" | "Approved" | "Waiting on others" | "Drafts" | "Recently merged";

interface Move {
	/** The verb on the row's badge. */
	label: string;
	group: MoveGroup;
	/** The quick actions that hand this move to an agent, in preference order: the first that applies makes it. */
	actions: PullRequestActionId[];
}

/** In rank order: within a group, a row's move ranks it before the sort applies. */
export const MOVES: Record<MoveId, Move> = {
	review: { label: "Review", group: "Your move", actions: ["review"] },
	merge: { label: "Merge", group: "Your move", actions: [] },
	"fix-ci": { label: "Fix CI", group: "Your move", actions: ["fix-ci"] },
	// Conflicts rank before failing checks, so a pull request with both is a rebase; one session fixes both.
	rebase: { label: "Rebase", group: "Your move", actions: ["fix-ci-and-conflicts", "resolve-conflicts"] },
	reply: { label: "Reply", group: "Your move", actions: ["address-comments"] },
	answer: { label: "Answer", group: "Agent on it", actions: [] },
	agent: { label: "Working", group: "Agent on it", actions: [] },
	"in-review": { label: "In review", group: "Waiting on others", actions: [] },
	"checks-running": { label: "CI running", group: "Waiting on others", actions: [] },
	draft: { label: "Draft", group: "Drafts", actions: [] },
	merged: { label: "Merged", group: "Recently merged", actions: [] },
};

const MOVE_IDS = Object.keys(MOVES) as MoveId[];

/**
 * The list's sections in page order, whether each starts folded in the list, and whether it starts folded on the board.
 * The list folds those that hold nothing for you or an agent to do now; Drafts stay open, since they are your work in
 * progress. The board folds only **Recently merged**, a week of merges, since a column of what waits on others is where
 * a drop starts.
 */
const GROUPS: Record<MoveGroup, { folded: boolean; boardFolded: boolean }> = {
	"Your move": { folded: false, boardFolded: false },
	"Agent on it": { folded: false, boardFolded: false },
	Approved: { folded: false, boardFolded: false },
	"Waiting on others": { folded: true, boardFolded: false },
	Drafts: { folded: false, boardFolded: false },
	"Recently merged": { folded: true, boardFolded: true },
};

const GROUP_TITLES = Object.keys(GROUPS) as MoveGroup[];

/** The moves, in rank order, that leave an approved pull request of yours in **Approved**: none asks you to fix anything. */
const APPROVED_MOVES: MoveId[] = ["merge", "checks-running", "draft"];

/** The section `pr` goes in while it waits on `move`. */
const groupOf = (pr: PullRequestSummary, move: MoveId): MoveGroup => (pr.review === "approved" && APPROVED_MOVES.includes(move) ? "Approved" : MOVES[move].group);

const AND = new Intl.ListFormat("en", { type: "conjunction" });

const REASON: Record<MoveId, (pr: PullRequestSummary) => string> = {
	review: pr => `@${pr.author.login}`,
	merge: pr => `${pr.review === "none" ? "no review needed" : "approved"} · ${pr.checks === "none" ? "no checks" : "checks green"}`,
	"fix-ci": () => "checks failing",
	rebase: pr => `conflicts with ${pr.stackedOn ?? "base"}`,
	reply: pr => {
		const { count, exact } = pr.unresolved;
		const threads = hasOpenThreads(pr) ? `${count}${exact ? "" : "+"} open ${count === 1 && exact ? "thread" : "threads"}` : null;
		const requested = pr.review === "changes-requested" ? "changes requested" : null;
		return [threads, requested].filter(part => part !== null).join(" · ");
	},
	answer: () => "a session asks you",
	agent: () => "an agent is working on it",
	"in-review": pr => {
		const waitingOn = pr.reviewers.filter(reviewer => reviewer.state === "requested").map(({ login }) => `@${login}`);
		return waitingOn.length > 0 ? `waiting on ${AND.format(waitingOn)}` : "waiting for review";
	},
	"checks-running": () => "checks running",
	draft: () => "draft",
	merged: () => "merged",
};

/** Why `pr` waits on `move`, as its row's second line says after its number. */
export const reason = (pr: PullRequestSummary, move: MoveId): string => REASON[move](pr);

/** The first quick action that hands `move` on `pr` to an agent and applies to `pr`, if any. */
export function moveAction(pr: PullRequestSummary, move: MoveId): PullRequestActionId | null {
	const applying = pullRequestActions(pr);
	return MOVES[move].actions.find(action => applying.includes(action)) ?? null;
}

/** Where a pull request sits in a stack of two or more that the list holds: `position` 1 is the bottom, which merges first. */
export interface StackPlace {
	position: number;
	/** The longest chain in the stack. */
	size: number;
	/** The pull request right above it in the stack is the row before it in its section. */
	joinsAbove: boolean;
	/** The pull request right below it in the stack is the row after it in its section. */
	joinsBelow: boolean;
}

export interface SectionRow {
	pr: PullRequestSummary;
	move: MoveId;
	stack: StackPlace | null;
	/** The rows that move together: a stack's members share it, and a pull request in no stack has its own. */
	unit: string;
}

export interface PullRequestSection {
	title: MoveGroup;
	/** By move in rank order, then in the list's sort; the manual sort keeps your order alone. Either way, except that a stack's members in the section sit together, top first, where its first member in the sort would. */
	rows: SectionRow[];
}

interface StackMember {
	/** The head branch of the stack's bottom pull request, which names the stack. */
	root: string;
	position: number;
	size: number;
}

/** Each open or draft pull request in a stack of two or more that the list holds, by the chain of base branches. */
function stackMembers(pullRequests: PullRequestSummary[]): Map<PullRequestSummary, StackMember> {
	const live = pullRequests.filter(pr => pr.state !== "merged");
	const byHead = new Map(live.map(pr => [pr.head, pr]));
	const places = live.map(pr => {
		// GitHub cannot report a cycle of bases, but one must not hang the page.
		const seen = new Set([pr]);
		let bottom = pr;
		for (let below = byHead.get(pr.stackedOn ?? ""); below && !seen.has(below); below = byHead.get(below.stackedOn ?? "")) {
			seen.add(below);
			bottom = below;
		}
		return { pr, root: bottom.head, position: seen.size };
	});
	const members = new Map<PullRequestSummary, StackMember>();
	for (const stack of Map.groupBy(places, place => place.root).values()) {
		if (stack.length < 2) continue;
		const size = Math.max(...stack.map(place => place.position));
		for (const { pr, root, position } of stack) members.set(pr, { root, position, size });
	}
	return members;
}

/** Your open or draft pull request without conflicts, whose branch a rebase may push; one with conflicts gets **Resolve conflicts** instead. */
const rebasable = (pr: PullRequestSummary): boolean => pr.role === "author" && pr.state !== "merged" && !pr.conflicts;

/** Whether **Rebase on** its base applies to `pr`: your pull request, behind its base and without conflicts. */
export const rebaseApplies = (pr: PullRequestSummary): boolean => rebasable(pr) && pr.behind;

/** A branch of the pull request's repository, as one key: a stack links its pull requests by branch within one repository. */
export const branchKey = (pr: PullRequest, branch: string): string => `${repoKey(pr)}:${branch}`;

/**
 * What **Rebase behind** rebases, in order: the pull requests {@link rebaseApplies} to, and every rebasable one stacked
 * on one of them in the same repository, which falls behind only once the one below it is pushed. The bottom of a stack
 * comes first; otherwise they keep the order of `pullRequests`.
 */
export function rebaseOrder(pullRequests: readonly PullRequestSummary[]): PullRequestSummary[] {
	const above = Map.groupBy(pullRequests.filter(pr => rebasable(pr) && pr.stackedOn !== null), pr => branchKey(pr, pr.stackedOn!));
	const chosen = new Set(pullRequests.filter(rebaseApplies));
	// A set's loop also visits what it adds, and adds nothing twice, so a cycle of bases ends.
	for (const pr of chosen) for (const child of above.get(branchKey(pr, pr.head)) ?? []) chosen.add(child);
	const byHead = new Map([...chosen].map(pr => [branchKey(pr, pr.head), pr]));
	const depth = (pr: PullRequestSummary): number => {
		const seen = new Set([pr]);
		for (let below = byHead.get(branchKey(pr, pr.stackedOn ?? "")); below && !seen.has(below); below = byHead.get(branchKey(below, below.stackedOn ?? ""))) seen.add(below);
		return seen.size;
	};
	return pullRequests.filter(pr => chosen.has(pr)).map(pr => ({ pr, depth: depth(pr) })).sort((a, b) => a.depth - b.depth).map(({ pr }) => pr);
}

/** How the list orders a section's pull requests; a stack's members sit together, top first, in every sort. */
export type PullRequestSort = "updated" | "newest" | "oldest" | "manual";

export const PULL_REQUEST_SORTS: Record<PullRequestSort, string> = { updated: "Recently updated", newest: "Newest first", oldest: "Oldest first", manual: "Manual" };

/** The order you gave the pull request list, which the browser keeps. Keys you never placed follow their default order. */
export interface PullRequestOrder {
	/** `repoKey`s; a repository you never moved follows them, in the order GitHub was asked. */
	repos: string[];
	/** Section titles; one you never moved follows them, in {@link MoveGroup}'s order. */
	sections: string[];
	sort: PullRequestSort;
	/** `prKey`s, for the manual sort; a pull request you never placed goes first, most recently updated first, since it is new to you. */
	manual: string[];
}

export const DEFAULT_ORDER: PullRequestOrder = { repos: [], sections: [], sort: "updated", manual: [] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(item => typeof item === "string") : []);

/** The stored order, or {@link DEFAULT_ORDER} for what is missing or unreadable. */
export function decodeOrder(raw: string | null): PullRequestOrder {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return DEFAULT_ORDER;
	}
	if (typeof stored !== "object" || stored === null) return DEFAULT_ORDER;
	const { repos, sections, sort, manual } = stored as Record<string, unknown>;
	return { repos: strings(repos), sections: strings(sections), sort: typeof sort === "string" && sort in PULL_REQUEST_SORTS ? (sort as PullRequestSort) : "updated", manual: strings(manual) };
}

/** `items` in `order` by `keyOf`, then the items `order` does not name, as they came. */
function inOrder<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[]): T[] {
	const at = new Map(order.map((key, index) => [key, index]));
	return items.toSorted((a, b) => (at.get(keyOf(a)) ?? order.length) - (at.get(keyOf(b)) ?? order.length));
}

const BY_SORT: Record<Exclude<PullRequestSort, "manual">, (a: PullRequestSummary, b: PullRequestSummary) => number> = {
	updated: (a, b) => b.updatedAt - a.updatedAt,
	newest: (a, b) => b.number - a.number,
	oldest: (a, b) => a.number - b.number,
};

type Moved = Pick<SectionRow, "pr" | "move">;

const rank = (move: MoveId): number => MOVE_IDS.indexOf(move);

function sorted(moved: Moved[], { sort, manual }: PullRequestOrder): Moved[] {
	if (sort !== "manual") return moved.toSorted((a, b) => rank(a.move) - rank(b.move) || BY_SORT[sort](a.pr, b.pr));
	const at = new Map(manual.map((key, index) => [key, index]));
	return moved.toSorted((a, b) => (at.get(prKey(a.pr)) ?? -1) - (at.get(prKey(b.pr)) ?? -1) || BY_SORT.updated(a.pr, b.pr));
}

/** The section titles in page order. */
export const sectionTitles = (order: PullRequestOrder): MoveGroup[] => inOrder(GROUP_TITLES, title => title, order.sections);

/** The list's repositories in page order. */
export const orderedRepos = <R extends Repo>(repos: readonly R[], order: PullRequestOrder): R[] => inOrder(repos, repoKey, order.repos);

/** A repository's pull requests by whose move it is, leaving out the empty sections, each row with its move and its place in a stack. */
export function pullRequestSections(pullRequests: PullRequestSummary[], order: PullRequestOrder, agentOn: AgentOn): PullRequestSection[] {
	const members = stackMembers(pullRequests);
	const moved = pullRequests.map((pr): Moved => ({ pr, move: moveOf(pr, agentOn(pr)) }));
	const taken = Map.groupBy(sorted(moved, order), ({ pr, move }) => groupOf(pr, move));
	return sectionTitles(order).flatMap((title): PullRequestSection[] => {
		const prs = taken.get(title);
		if (!prs) return [];
		const unitOf = ({ pr }: Moved): string => {
			const member = members.get(pr);
			return member ? `stack:${member.root}` : prKey(pr);
		};
		// A group keeps its first member's place, so a stack sits where its first member in the sort would.
		const groups = Map.groupBy(prs, unitOf);
		const ordered = [...groups.values()].flatMap(group => group.toSorted((a, b) => (members.get(b.pr)?.position ?? 0) - (members.get(a.pr)?.position ?? 0)));
		const rows = ordered.map((row, at): SectionRow => {
			const member = members.get(row.pr);
			if (!member) return { ...row, stack: null, unit: unitOf(row) };
			const joins = (other: Moved | undefined, step: number): boolean => {
				const place = other && members.get(other.pr);
				return !!place && place.root === member.root && place.position === member.position + step;
			};
			return { ...row, stack: { position: member.position, size: member.size, joinsAbove: joins(ordered[at - 1], 1), joinsBelow: joins(ordered[at + 1], -1) }, unit: unitOf(row) };
		});
		return [{ title, rows }];
	});
}

/** What a section holds by move, in rank order, such as `2 in review · 1 CI running`; `null` for a section only one move goes in, whose count says it all. */
export function movesSummary({ title, rows }: PullRequestSection): string | null {
	const moves = title === "Approved" ? APPROVED_MOVES : MOVE_IDS.filter(move => MOVES[move].group === title);
	if (moves.length < 2) return null;
	const counts = Map.groupBy(rows, row => row.move);
	return MOVE_IDS.flatMap(move => {
		const count = counts.get(move)?.length;
		// Sentence case, which keeps an acronym such as CI.
		return count ? [`${count} ${MOVES[move].label.replace(/^[A-Z](?=[a-z])/, letter => letter.toLowerCase())}`] : [];
	}).join(" · ");
}

export type Where = "before" | "after";

/** `keys` with `key` moved to just before or after `target`; unchanged when either is missing or they are one. */
export function moveKey(keys: readonly string[], key: string, target: string, where: Where): string[] {
	if (key === target || !keys.includes(key) || !keys.includes(target)) return [...keys];
	const rest = keys.filter(other => other !== key);
	const at = rest.indexOf(target) + (where === "after" ? 1 : 0);
	return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/** The neighbor `key` swaps with when it moves one place `by`, and on which side; `null` at the edge. */
export function stepTarget(keys: readonly string[], key: string, by: 1 | -1): { target: string; where: Where } | null {
	const target = keys[keys.indexOf(key) + by];
	return target === undefined || !keys.includes(key) ? null : { target, where: by === 1 ? "after" : "before" };
}

/**
 * The manual order after moving `unit` beside `target` in `section`: every pull request of the repository placed as the
 * page shows it now, so switching to the manual sort keeps the order you see. Keys of the repository's pull requests
 * that left the list drop out; other repositories' keys stay.
 */
export function placedManual(manual: readonly string[], repo: Repo, sections: PullRequestSection[], section: MoveGroup, unit: string, target: string, where: Where): string[] {
	const placed = sections.flatMap(({ title, rows }) => {
		if (title !== section) return rows.map(row => prKey(row.pr));
		const byUnit = Map.groupBy(rows, row => row.unit);
		return moveKey([...byUnit.keys()], unit, target, where).flatMap(key => byUnit.get(key)!.map(row => prKey(row.pr)));
	});
	const prefix = `${repoKey(repo)}#`;
	return [...placed, ...manual.filter(key => !key.startsWith(prefix))];
}

/** A repository's fold key, or one of its sections'; the browser keeps them in localStorage. A repository's name holds no `:`. */
export const sectionFoldKey = (repo: string, title: string): string => `${repo}:${title}`;

/** Whether the list folds the repository or section that `key` names until you unfold it. */
export const foldedByDefault = (key: string): boolean => GROUP_TITLES.some(title => GROUPS[title].folded && key.endsWith(`:${title}`));

/** The pull requests the list shows, in its order: those of readable repositories and sections that `isFolded` leaves open. */
export function shownPullRequests({ repos }: PullRequestList, isFolded: (key: string) => boolean, order: PullRequestOrder, agentOn: AgentOn): PullRequestSummary[] {
	return orderedRepos(repos, order).flatMap(repo => {
		const key = repoKey(repo);
		if ("error" in repo || isFolded(key)) return [];
		return pullRequestSections(repo.pullRequests, order, agentOn).flatMap(({ title, rows }) => (isFolded(sectionFoldKey(key, title)) ? [] : rows.map(row => row.pr)));
	});
}

/** A pull request on the board, with its repository's key and the workspace a session on it starts in. */
export interface BoardCard {
	row: SectionRow;
	repo: string;
	cwd: string;
}

/** One of the board's columns: a section, with every readable repository's pull requests in it, repository by repository. */
export interface BoardColumn {
	title: MoveGroup;
	cards: BoardCard[];
}

/** The board: one column per section in page order, empty ones too, since a pull request can be dropped on them. */
export function boardColumns({ repos }: PullRequestList, order: PullRequestOrder, agentOn: AgentOn): BoardColumn[] {
	const cards = new Map<MoveGroup, BoardCard[]>(sectionTitles(order).map(title => [title, []]));
	for (const repo of orderedRepos(repos, order)) {
		const cwd = repo.cwds[0];
		if ("error" in repo || cwd === undefined) continue;
		const key = repoKey(repo);
		for (const { title, rows } of pullRequestSections(repo.pullRequests, order, agentOn)) cards.get(title)!.push(...rows.map(row => ({ row, repo: key, cwd })));
	}
	return [...cards].map(([title, held]) => ({ title, cards: held }));
}

/** Whether the board folds the column `title` until you unfold it. */
export const boardFoldedByDefault = (title: string): boolean => GROUP_TITLES.some(each => GROUPS[each].boardFolded && title === each);

/** The pull requests the board shows, in its order: column by column, leaving out those that `isFolded` folds. */
export const shownBoardPullRequests = (columns: readonly BoardColumn[], isFolded: (title: string) => boolean): PullRequestSummary[] =>
	columns.flatMap(({ title, cards }) => (isFolded(title) ? [] : cards.map(({ row }) => row.pr)));

/**
 * What dropping a pull request on another column does. A column follows where the pull request stands on GitHub, so a
 * drop runs the step that moves it there, or is refused with why.
 */
export type BoardDrop =
	| { kind: "agent"; action: PullRequestActionId; label: string }
	| { kind: "merge"; label: string }
	| { kind: "state"; state: Extract<SettableState, "open" | "draft">; label: string }
	| { kind: "refused"; why: string };

/** The columns a draft lands in once it is ready for review, whichever its move then picks. */
const READY_COLUMNS: MoveGroup[] = ["Your move", "Approved", "Waiting on others"];

const refused = (why: string): BoardDrop => ({ kind: "refused", why });

/**
 * What dropping `row` from the column `from` on the column `to` does; `null` when it stays in its column. **Agent on it**
 * starts the quick action of its move, **Recently merged** merges it when its row offers the merge, **Drafts** converts
 * your open pull request to a draft, and an open column marks your draft ready for review.
 */
export function boardDrop({ pr, move }: SectionRow, from: MoveGroup, to: MoveGroup): BoardDrop | null {
	if (from === to) return null;
	if (pr.state === "merged") return refused("It is merged already");
	if (to === "Agent on it") {
		const action = moveAction(pr, move);
		return action ? { kind: "agent", action, label: `${PULL_REQUEST_ACTIONS[action].label} with an agent` } : refused(`No agent step applies: ${reason(pr, move)}`);
	}
	if (to === "Recently merged") {
		if (move === "merge") return { kind: "merge", label: "Merge" };
		if (move === "checks-running" && readyOnceChecksPass(pr)) return { kind: "merge", label: "Merge once checks pass" };
		return refused(`Not ready to merge: ${reason(pr, move)}`);
	}
	if (to === "Drafts") {
		if (pr.state !== "open") return refused("It is a draft already");
		if (pr.role !== "author") return refused("Only its author changes whether it is a draft");
		return { kind: "state", state: "draft", label: "Convert to draft" };
	}
	if (pr.state === "draft" && READY_COLUMNS.includes(to)) {
		if (pr.role !== "author") return refused("Only its author changes whether it is a draft");
		return { kind: "state", state: "open", label: "Ready for review" };
	}
	return refused(`${to} fills from GitHub; no step moves it there`);
}

/** The pull request as `list` holds it, with the workspace a session on it starts in; `null` when `list` leaves it out. */
export function listedPullRequest(list: PullRequestList, pr: PullRequest): { pr: PullRequestSummary; cwd: string } | null {
	for (const repo of list.repos) {
		if ("error" in repo) continue;
		const listed = repo.pullRequests.find(other => samePullRequest(other, pr));
		if (listed && repo.cwds[0] !== undefined) return { pr: listed, cwd: repo.cwds[0] };
	}
	return null;
}

/** Every pull request `repos` lists, leaving out the repositories GitHub could not read. */
export const listedPullRequests = (repos: readonly RepoPullRequests[]): PullRequestSummary[] => repos.flatMap(repo => ("error" in repo ? [] : repo.pullRequests));

/** A change a row makes that moves its pull request in the list: a state change; a merge goes through the merge queue. */
export type ListChange = Extract<PullRequestChange, { field: "state" }>;

/**
 * The list after `pr` took `state` on GitHub at `at`, until the list is read again: a closed pull request leaves it,
 * since it lists none; a merged one moves to **Recently merged**. Every repository and row it leaves alone stays the same object.
 */
export function withPullRequestState(list: PullRequestList, pr: PullRequest, state: ListChange["state"] | "merged", at: number): PullRequestList {
	const changed = (row: PullRequestSummary): PullRequestSummary[] => {
		if (state === "merged") return [{ ...row, state, updatedAt: at }];
		return state === "closed" ? [] : [{ ...row, state }];
	};
	return {
		...list,
		repos: list.repos.map(repo =>
			"error" in repo || !repo.pullRequests.some(row => samePullRequest(row, pr))
				? repo
				: { ...repo, pullRequests: repo.pullRequests.flatMap(row => (samePullRequest(row, pr) ? changed(row) : [row])) },
		),
	};
}

/** How many pull requests in the list wait on your move. */
export const yourMoveCount = ({ repos }: PullRequestList, agentOn: AgentOn): number => listedPullRequests(repos).filter(pr => groupOf(pr, moveOf(pr, agentOn(pr))) === "Your move").length;

/** The review threads not yet resolved, in GitHub's order. */
export const openThreads = ({ threads }: Pick<PullRequestDetail, "threads">): PullRequestThread[] => threads.filter(thread => !thread.resolved);

/** The comments and reviews of the conversation that have words. */
export const spokenConversation = ({ conversation }: Pick<PullRequestDetail, "conversation">): PullRequestDetail["conversation"] => conversation.filter(event => event.body.trim() !== "");

/** The pull request's comments, which the **Timeline** tab and its header count: every review thread's, resolved or not and beyond the first 20 loaded, and the conversation's with words. */
export const commentCount = (detail: Pick<PullRequestDetail, "threads" | "conversation">): number =>
	detail.threads.reduce((sum, thread) => sum + thread.commentCount, 0) + spokenConversation(detail).length;

/** What the details show once thread `id` is `resolved`: its threads and their unresolved count together, so every count agrees while GitHub answers. */
export function withThreadResolved(detail: PullRequestDetail, id: string, resolved: boolean): Pick<PullRequestDetail, "threads" | "unresolved"> {
	const threads = detail.threads.map(thread => (thread.id === id ? { ...thread, resolved } : thread));
	return { threads, unresolved: { count: openThreads({ threads }).length, exact: detail.unresolved.exact } };
}

/** Why the Code tab takes no line comments: a commit is picked, or the Review draft is posted or reviews an older head; `null` when it takes them. */
export function lineCommentsBlocked(commit: string | null, draft: ReviewDraft | undefined, headOid: string): string | null {
	if (commit !== null) return "Line comments are written from All commits.";
	if (draft && (draft.posted !== null || draft.head !== headOid)) return "The Review draft is posted or belongs to an older head. Discard it before adding comments.";
	return null;
}
