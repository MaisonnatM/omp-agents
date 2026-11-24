/** What each pull request waits on next, the list's sections and stacks, what stands between a pull request and its merge, its open review threads, and the state changes it offers. */
import { isObject, isString, oneOf, parseJson } from "../src/json";
import { PULL_REQUEST_ACTIONS, type PullRequestActionId, pullRequestActions } from "../src/pull-request-actions";
import { type PullRequestList, type PullRequestSummary, type PullRequest, type PullRequestChange, type PullRequestDetail, type Repo, type RepoPullRequests, type Reviewer, prKey, repoKey, samePullRequest, type SettableState, unresolvedOf } from "../src/shared/github";
import { type AgentOn, hasOpenThreads, type MoveId, moveOf } from "../src/shared/moves";
import type { ReviewDraft } from "../src/shared/review-drafts";
import { moveKey, stepTarget, type Where } from "./order";

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
 * The list's sections in page order, and whether each starts folded. The list folds those that hold nothing for you or
 * an agent to do now; Drafts stay open, since they are your work in progress.
 */
const GROUPS: Record<MoveGroup, { folded: boolean }> = {
	"Your move": { folded: false },
	"Agent on it": { folded: false },
	Approved: { folded: false },
	"Waiting on others": { folded: true },
	Drafts: { folded: false },
	"Recently merged": { folded: true },
};

/** The list's sections in page order, before your own order of them. */
export const GROUP_TITLES = Object.keys(GROUPS) as MoveGroup[];

/** The moves, in rank order, that leave an approved pull request of yours in **Approved**: none asks you to fix anything. */
const APPROVED_MOVES: MoveId[] = ["merge", "checks-running", "draft"];

/** The label that holds a pull request's merge until a person approves it, so an approval alone leaves it **Waiting on others**. */
const ASK_HUMAN = "ask-human";

/** The section `pr` goes in while it waits on `move`. */
function groupOf(pr: PullRequestSummary, move: MoveId): MoveGroup {
	if (pr.review !== "approved" || !APPROVED_MOVES.includes(move)) return MOVES[move].group;
	return pr.labels?.includes(ASK_HUMAN) ? "Waiting on others" : "Approved";
}

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

/** Who started the open threads a **Reply** waits on: `ai` of them a bot, `human` a person, with the tooltip saying so. */
export interface ThreadStarters {
	ai: number;
	human: number;
	label: string;
}

/** Who started `pr`'s open threads while it waits on `move`, as its row's tag shows; `null` unless a **Reply** waits on some listed thread. */
export function threadStarters(pr: PullRequestSummary, move: MoveId): ThreadStarters | null {
	const { count, exact, bots } = pr.unresolved;
	if (move !== "reply" || count === 0) return null;
	const human = count - bots;
	const threads = (n: number): string => `${n} open ${n === 1 ? "thread" : "threads"}`;
	const counted = [bots > 0 && `${threads(bots)} from AI`, human > 0 && `${threads(human)} from people`].filter(Boolean).join(", ");
	return { ai: bots, human, label: exact ? counted : `${counted}, among the threads GitHub listed` };
}

/** The first quick action that hands `move` on `pr` to an agent and applies to `pr`, if any. */
export function moveAction(pr: PullRequestSummary, move: MoveId): PullRequestActionId | null {
	const applying = pullRequestActions(pr);
	return MOVES[move].actions.find(action => applying.includes(action)) ?? null;
}

/** The moves a **Your move** table's heading hands to agents for all its pull requests at once, in the order its buttons show. */
const BULK_MOVES: MoveId[] = ["reply", "fix-ci", "rebase"];

/** A move a table's heading hands to agents at once: each of its rows with the quick action that makes it. */
export interface BulkMove<R> {
	move: MoveId;
	items: { row: R; action: PullRequestActionId }[];
}

/** The {@link BULK_MOVES} that some of `rows` wait on with a quick action that applies, leaving out the rows whose session is starting. */
export function bulkMoves<R extends { row: SectionRow; pending: unknown }>(rows: R[]): BulkMove<R>[] {
	return BULK_MOVES.flatMap(move => {
		const items = rows.flatMap(row => {
			const action = row.pending === null && row.row.move === move ? moveAction(row.row.pr, move) : null;
			return action ? [{ row, action }] : [];
		});
		return items.length > 0 ? [{ move, items }] : [];
	});
}

/**
 * The session its row shows `action` on a pull request most likely going to, from the pull request's sessions in the order
 * its row's chips show them: the first, a running one before an ended one and the one that opened it before one that only
 * worked on it; the server picks the owner itself when the action runs. `null` when no session is linked to it, or for an
 * action that does not reach the owner, such as **Review**, which always starts a new session.
 */
export const fixOwner = <S>(sessions: readonly S[], action: PullRequestActionId): S | null => (PULL_REQUEST_ACTIONS[action].reachesOwner ? (sessions[0] ?? null) : null);

/** What a heading button that hands a move to `count` pull requests reads once armed, `owned` of them going to their sessions: `Confirm 4? · 3 to sessions, 1 new`. */
export function confirmLabel(count: number, owned: number): string {
	const fresh = count - owned;
	const parts = [owned > 0 && `${owned} to ${owned === 1 ? "session" : "sessions"}`, fresh > 0 && `${fresh} new`].filter(Boolean);
	return `Confirm ${count}? · ${parts.join(", ")}`;
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

/** The bottom of `pr`'s stack among `byHead`, the pull requests by head branch, and how many there are from `pr` down to it, both counted. */
function chainBelow(pr: PullRequestSummary, byHead: ReadonlyMap<string, PullRequestSummary>): { bottom: PullRequestSummary; size: number } {
	// GitHub cannot report a cycle of bases, but one must not hang the page.
	const seen = new Set([pr]);
	let bottom = pr;
	for (let below = byHead.get(pr.stackedOn ?? ""); below && !seen.has(below); below = byHead.get(below.stackedOn ?? "")) {
		seen.add(below);
		bottom = below;
	}
	return { bottom, size: seen.size };
}

/** Each open or draft pull request in a stack of two or more that the list holds, by the chain of base branches. */
function stackMembers(pullRequests: PullRequestSummary[]): Map<PullRequestSummary, StackMember> {
	const live = pullRequests.filter(pr => pr.state !== "merged");
	const byHead = new Map(live.map(pr => [pr.head, pr]));
	const places = live.map(pr => {
		const { bottom, size } = chainBelow(pr, byHead);
		return { pr, root: bottom.head, position: size };
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

/**
 * What **Rebase behind** rebases in one repository's `pullRequests`, in order: those {@link rebaseApplies} to, and every
 * rebasable one stacked on one of them, which falls behind only once the one below it is pushed. The bottom of a stack
 * comes first; otherwise they keep the order of `pullRequests`.
 */
export function rebaseOrder(pullRequests: readonly PullRequestSummary[]): PullRequestSummary[] {
	const above = Map.groupBy(pullRequests.filter(pr => rebasable(pr) && pr.stackedOn !== null), pr => pr.stackedOn);
	const chosen = new Set(pullRequests.filter(rebaseApplies));
	// A set's loop also visits what it adds, and adds nothing twice, so a cycle of bases ends.
	for (const pr of chosen) for (const child of above.get(pr.head) ?? []) chosen.add(child);
	const byHead = new Map([...chosen].map(pr => [pr.head, pr]));
	return pullRequests.filter(pr => chosen.has(pr)).map(pr => ({ pr, depth: chainBelow(pr, byHead).size })).sort((a, b) => a.depth - b.depth).map(({ pr }) => pr);
}

/** How the list orders a section's pull requests, in menu order; a stack's members sit together, top first, in every sort. */
export const PULL_REQUEST_SORTS = ["updated", "newest", "oldest", "manual"] as const;

export type PullRequestSort = (typeof PULL_REQUEST_SORTS)[number];

export const SORT_LABELS: Record<PullRequestSort, string> = { updated: "Recently updated", newest: "Newest first", oldest: "Oldest first", manual: "Manual" };

const isSort = oneOf(PULL_REQUEST_SORTS);

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

/** The strings of `value`, an array; none when it is no array. */
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);

/** The stored order, or {@link DEFAULT_ORDER} for what is missing or unreadable. */
export function decodeOrder(raw: string | null): PullRequestOrder {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return DEFAULT_ORDER;
	const { repos, sections, sort, manual } = stored;
	return { repos: strings(repos), sections: strings(sections), sort: isSort(sort) ? sort : "updated", manual: strings(manual) };
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

/** The list without the repositories you hid, by `repoKey`; the same list while you hide none. */
export const withoutHidden = (list: PullRequestList, hidden: ReadonlySet<string>): PullRequestList =>
	hidden.size === 0 ? list : { ...list, repos: list.repos.filter(repo => !hidden.has(repoKey(repo))) };

/** `order` with the repository `key` put on the `where` side of `beside`, among `keys`, the list's repositories in page order; the repositories `keys` leaves out keep their place behind them. */
export const withRepoMoved = (order: PullRequestOrder, keys: readonly string[], key: string, beside: string, where: Where): PullRequestOrder => ({
	...order,
	repos: moveKey([...keys, ...order.repos.filter(other => !keys.includes(other))], key, beside, where),
});

/**
 * `order` with the repository `key` one place `by` among `among`, the repositories the page shows in page order, placed
 * among `every`, all of them in page order, so the ones `among` leaves out keep their place; `null` at the edge.
 */
export function withRepoStepped(order: PullRequestOrder, every: readonly string[], among: readonly string[], key: string, by: 1 | -1): PullRequestOrder | null {
	const step = stepTarget(among, key, by);
	return step && withRepoMoved(order, every, key, step.target, step.where);
}

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

/** The sections of each of `repos`, at the same index; none for a repository GitHub could not read. */
export const sectionsOfRepos = (repos: readonly RepoPullRequests[], order: PullRequestOrder, agentOn: AgentOn): PullRequestSection[][] =>
	repos.map(repo => ("error" in repo ? [] : pullRequestSections(repo.pullRequests, order, agentOn)));

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

/** Whether the list folds the heading or table that `key` names until you unfold it. */
export const foldedByDefault = (key: string): boolean => GROUP_TITLES.some(title => GROUPS[title].folded && key.endsWith(`:${title}`));

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

/** A change a row makes to its pull request in the list: a state change, a review request, or an approval; a merge goes through the merge queue. */
export type ListChange = Extract<PullRequestChange, { field: "state" | "reviewer" | "review" }>;

/** The list with `changed` in place of `pr`'s row; every repository and row it leaves alone stays the same object. */
function withRow(list: PullRequestList, pr: PullRequest, changed: (row: PullRequestSummary) => PullRequestSummary[]): PullRequestList {
	return {
		...list,
		repos: list.repos.map(repo =>
			"error" in repo || !repo.pullRequests.some(row => samePullRequest(row, pr))
				? repo
				: { ...repo, pullRequests: repo.pullRequests.flatMap(row => (samePullRequest(row, pr) ? changed(row) : [row])) },
		),
	};
}

/**
 * The list after `pr` took `state` on GitHub at `at`, until the list is read again: a closed pull request leaves it,
 * since it lists none; a merged one moves to **Recently merged**. Every repository and row it leaves alone stays the same object.
 */
export function withPullRequestState(list: PullRequestList, pr: PullRequest, state: SettableState | "merged", at: number): PullRequestList {
	return withRow(list, pr, row => {
		if (state === "merged") return [{ ...row, state, updatedAt: at }];
		return state === "closed" ? [] : [{ ...row, state }];
	});
}

/**
 * `reviewers` once a review is asked of `login` (`on`), first and waiting, in place of what they did before; or once
 * the request is withdrawn, which drops them. A re-request without `avatarUrl` keeps the picture they had.
 */
export function withReviewer(reviewers: readonly Reviewer[], login: string, on: boolean, avatarUrl: string | null): Reviewer[] {
	const others = reviewers.filter(reviewer => reviewer.login !== login);
	if (!on) return others;
	const picture = avatarUrl ?? reviewers.find(reviewer => reviewer.login === login)?.avatarUrl ?? null;
	return [{ login, avatarUrl: picture, state: "requested" }, ...others];
}

/** The list after a review was asked of `login` on `pr`, or withdrawn, until the list is read again. */
export const withPullRequestReviewers = (list: PullRequestList, pr: PullRequest, login: string, on: boolean, avatarUrl: string | null): PullRequestList =>
	withRow(list, pr, row => [{ ...row, reviewers: withReviewer(row.reviewers, login, on, avatarUrl) }]);

/** How many pull requests in the list wait on your move. */
export const yourMoveCount = ({ repos }: PullRequestList, agentOn: AgentOn): number => listedPullRequests(repos).filter(pr => groupOf(pr, moveOf(pr, agentOn(pr))) === "Your move").length;

/** The comments and reviews of the conversation that have words. */
export const spokenConversation = ({ conversation }: Pick<PullRequestDetail, "conversation">): PullRequestDetail["conversation"] => conversation.filter(event => event.body.trim() !== "");

/** The pull request's comments, which the **Timeline** tab and its header count: every review thread's, resolved or not and beyond the first 20 loaded, and the conversation's with words. */
export const commentCount = (detail: Pick<PullRequestDetail, "threads" | "conversation">): number =>
	detail.threads.reduce((sum, thread) => sum + thread.commentCount, 0) + spokenConversation(detail).length;

/** What the details show once thread `id` is `resolved`: its threads and their unresolved count together, so every count agrees while GitHub answers. */
export function withThreadResolved(detail: PullRequestDetail, id: string, resolved: boolean): Pick<PullRequestDetail, "threads" | "unresolved"> {
	const threads = detail.threads.map(thread => (thread.id === id ? { ...thread, resolved } : thread));
	return { threads, unresolved: unresolvedOf(threads, detail.unresolved.exact) };
}

/** Why the Code tab takes no line comments: a commit is picked, or the Review draft is posted or reviews an older head; `null` when it takes them. */
export function lineCommentsBlocked(commit: string | null, draft: ReviewDraft | undefined, headOid: string): string | null {
	if (commit !== null) return "Line comments are written from All commits.";
	if (draft && (draft.posted !== null || draft.head !== headOid)) return "The Review draft is posted or belongs to an older head. Discard it before adding comments.";
	return null;
}
