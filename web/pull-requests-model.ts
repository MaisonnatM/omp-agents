/** Pull request links, what each pull request waits on next, the inbox's sections and stacks, and what stands between a pull request and its merge. */
import { type PullRequestActionId, pullRequestActions } from "../src/pull-request-actions";
import { type PullRequestList, type PullRequestSummary, type PullRequest, type PullRequestCheck, type PullRequestDetail, type Repo, prKey, repoKey, samePullRequest } from "../src/shared/github";
import { type AgentOn, hasOpenThreads, type MoveId, moveOf, readyToMerge } from "../src/shared/moves";

export const graphiteUrl = (pr: PullRequest): string => `https://app.graphite.com/github/pr/${pr.owner}/${pr.repo}/${pr.number}`;

/** Whose move it is, or for your approved pull requests that need no fix, that they are approved; the inbox's sections, in page order. */
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

/** The inbox's sections in page order, and whether each starts folded: those that hold nothing for you or an agent to do now. Drafts stay open, since they are your work in progress. */
const GROUPS: Record<MoveGroup, { folded: boolean }> = {
	"Your move": { folded: false },
	"Agent on it": { folded: false },
	Approved: { folded: false },
	"Waiting on others": { folded: true },
	Drafts: { folded: false },
	"Recently merged": { folded: true },
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

/** Where a pull request sits in a stack of two or more that the inbox lists: `position` 1 is the bottom, which merges first. */
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
	/** By move in rank order, then in the inbox's sort; the manual sort keeps your order alone. Either way, except that a stack's members in the section sit together, top first, where its first member in the sort would. */
	rows: SectionRow[];
}

interface StackMember {
	/** The head branch of the stack's bottom pull request, which names the stack. */
	root: string;
	position: number;
	size: number;
}

/** Each open or draft pull request in a stack of two or more that the inbox lists, by the chain of base branches. */
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

/** How the inbox orders a section's pull requests; a stack's members sit together, top first, in every sort. */
export type PullRequestSort = "updated" | "newest" | "oldest" | "manual";

export const PULL_REQUEST_SORTS: Record<PullRequestSort, string> = { updated: "Recently updated", newest: "Newest first", oldest: "Oldest first", manual: "Manual" };

/** The order you gave the inbox, which the browser keeps. Keys you never placed follow their default order. */
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

/** The inbox's repositories in page order. */
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
 * that left the inbox drop out; other repositories' keys stay.
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

/** A repository's fold key, or one of its sections'; the inbox keeps them in localStorage. A repository's name holds no `:`. */
export const sectionFoldKey = (repo: string, title: string): string => `${repo}:${title}`;

/** Whether the inbox folds the repository or section that `key` names until you unfold it. */
export const foldedByDefault = (key: string): boolean => GROUP_TITLES.some(title => GROUPS[title].folded && key.endsWith(`:${title}`));

/** The pull requests the inbox shows, in its order: those of readable repositories and sections that `isFolded` leaves open. */
export function shownPullRequests({ repos }: PullRequestList, isFolded: (key: string) => boolean, order: PullRequestOrder, agentOn: AgentOn): PullRequestSummary[] {
	return orderedRepos(repos, order).flatMap(repo => {
		const key = repoKey(repo);
		if ("error" in repo || isFolded(key)) return [];
		return pullRequestSections(repo.pullRequests, order, agentOn).flatMap(({ title, rows }) => (isFolded(sectionFoldKey(key, title)) ? [] : rows.map(row => row.pr)));
	});
}

/** The pull request as the inbox lists it, with the workspace a session on it starts in; `null` when the inbox does not list it. */
export function listedPullRequest(inbox: PullRequestList, pr: PullRequest): { pr: PullRequestSummary; cwd: string } | null {
	for (const repo of inbox.repos) {
		if ("error" in repo) continue;
		const listed = repo.pullRequests.find(other => samePullRequest(other, pr));
		if (listed && repo.cwds[0] !== undefined) return { pr: listed, cwd: repo.cwds[0] };
	}
	return null;
}

/** How many pull requests in `inbox` wait on your move. */
export const yourMoveCount = ({ repos }: PullRequestList, agentOn: AgentOn): number =>
	repos.flatMap(repo => ("error" in repo ? [] : repo.pullRequests)).filter(pr => groupOf(pr, moveOf(pr, agentOn(pr))) === "Your move").length;

/** One fact about where a pull request stands, as its details' Status lists it. */
export type StatusItem =
	| { kind: "draft" }
	| { kind: "conflicts"; base: string }
	| { kind: "checks-failing"; count: number }
	| { kind: "checks-pending"; count: number }
	| { kind: "checks-passing"; passed: number; skipped: number }
	| { kind: "changes-requested"; by: string[] }
	| { kind: "approved"; by: string[] }
	| { kind: "review-required"; waitingOn: string[] }
	| { kind: "threads"; count: number; exact: boolean }
	| { kind: "ready" };

/** What stands between an open or draft pull request and its merge, blockers first; nothing once it is merged or closed. */
export function pullRequestStatus(detail: PullRequestDetail): StatusItem[] {
	if (detail.state === "merged" || detail.state === "closed") return [];
	const count = (state: PullRequestCheck["state"]): number => detail.checkRuns.filter(check => check.state === state).length;
	const by = (state: PullRequestDetail["reviewers"][number]["state"]): string[] => detail.reviewers.filter(reviewer => reviewer.state === state).map(({ login }) => login);
	const failing = count("failing");
	const pending = count("pending");
	const items: StatusItem[] = [];
	if (readyToMerge(detail)) items.push({ kind: "ready" });
	if (detail.state === "draft") items.push({ kind: "draft" });
	if (detail.conflicts) items.push({ kind: "conflicts", base: detail.base });
	if (failing > 0) items.push({ kind: "checks-failing", count: failing });
	if (detail.review === "changes-requested") items.push({ kind: "changes-requested", by: by("changes-requested") });
	if (hasOpenThreads(detail)) items.push({ kind: "threads", count: detail.unresolved.count, exact: detail.unresolved.exact });
	if (pending > 0) items.push({ kind: "checks-pending", count: pending });
	if (detail.review === "review-required") items.push({ kind: "review-required", waitingOn: by("requested") });
	if (detail.review === "approved") items.push({ kind: "approved", by: by("approved") });
	if (detail.checks === "passing") items.push({ kind: "checks-passing", passed: count("passing"), skipped: count("skipped") });
	return items;
}
