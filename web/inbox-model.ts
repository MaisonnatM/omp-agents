/** Pull request links, the inbox page's sections and stacks, and what stands between a pull request and its merge. */
import { type CheckState, type Inbox, type InboxPullRequest, type PullRequest, type PullRequestDetail, type Repo, type ReviewDecision, prKey, repoKey } from "../src/shared";

export const graphiteUrl = (pr: PullRequest): string => `https://app.graphite.com/github/pr/${pr.owner}/${pr.repo}/${pr.number}`;

/** Whose move a section's pull requests wait on: someone asks you to review, or a reviewer sent it back to you. */
export type Waiting = "your-review" | "your-fix";

interface SectionRule {
	title: string;
	takes: (pr: InboxPullRequest) => boolean;
	waiting: Waiting | null;
	/** Folded until you unfold it, since it lists history rather than work. */
	folded: boolean;
}

/** Graphite's inbox sections, in page order. A pull request goes in the first section that takes it. */
const SECTION_RULES: SectionRule[] = [
	{ title: "Needs your review", takes: pr => pr.role === "reviewer" && pr.state !== "merged", waiting: "your-review", folded: false },
	{ title: "Returned to you", takes: pr => pr.state === "open" && pr.review === "changes-requested", waiting: "your-fix", folded: false },
	{ title: "Approved", takes: pr => pr.state === "open" && pr.review === "approved", waiting: null, folded: false },
	{ title: "Waiting for review", takes: pr => pr.state === "open", waiting: null, folded: false },
	{ title: "Drafts", takes: pr => pr.state === "draft", waiting: null, folded: false },
	{ title: "Recently merged", takes: pr => pr.state === "merged", waiting: null, folded: true },
];

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

export interface InboxRow {
	pr: InboxPullRequest;
	stack: StackPlace | null;
	/** The rows that move together: a stack's members share it, and a pull request in no stack has its own. */
	unit: string;
}

export interface InboxSection {
	title: string;
	waiting: Waiting | null;
	/** In the inbox's sort, except that a stack's members in the section sit together, top first, where its first member in the sort would. */
	rows: InboxRow[];
}

interface StackMember {
	/** The head branch of the stack's bottom pull request, which names the stack. */
	root: string;
	position: number;
	size: number;
}

/** Each open or draft pull request in a stack of two or more that the inbox lists, by the chain of base branches. */
function stackMembers(pullRequests: InboxPullRequest[]): Map<InboxPullRequest, StackMember> {
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
	const members = new Map<InboxPullRequest, StackMember>();
	for (const stack of Map.groupBy(places, place => place.root).values()) {
		if (stack.length < 2) continue;
		const size = Math.max(...stack.map(place => place.position));
		for (const { pr, root, position } of stack) members.set(pr, { root, position, size });
	}
	return members;
}

const sectionOf = (pr: InboxPullRequest): SectionRule | undefined => SECTION_RULES.find(({ takes }) => takes(pr));

/** How the inbox orders a section's pull requests; a stack's members sit together, top first, in every sort. */
export type InboxSort = "updated" | "newest" | "oldest" | "manual";

export const INBOX_SORTS: Record<InboxSort, string> = { updated: "Recently updated", newest: "Newest first", oldest: "Oldest first", manual: "Manual" };

/** The order you gave the inbox, which the browser keeps. Keys you never placed follow their default order. */
export interface InboxOrder {
	/** `repoKey`s; a repository you never moved follows them, in the order GitHub was asked. */
	repos: string[];
	/** Section titles; one you never moved follows them, in Graphite's order. */
	sections: string[];
	sort: InboxSort;
	/** `prKey`s, for the manual sort; a pull request you never placed goes first, most recently updated first, since it is new to you. */
	manual: string[];
}

export const DEFAULT_ORDER: InboxOrder = { repos: [], sections: [], sort: "updated", manual: [] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(item => typeof item === "string") : []);

/** The stored order, or {@link DEFAULT_ORDER} for what is missing or unreadable. */
export function decodeOrder(raw: string | null): InboxOrder {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return DEFAULT_ORDER;
	}
	if (typeof stored !== "object" || stored === null) return DEFAULT_ORDER;
	const { repos, sections, sort, manual } = stored as Record<string, unknown>;
	return { repos: strings(repos), sections: strings(sections), sort: typeof sort === "string" && sort in INBOX_SORTS ? (sort as InboxSort) : "updated", manual: strings(manual) };
}

/** `items` in `order` by `keyOf`, then the items `order` does not name, as they came. */
function inOrder<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[]): T[] {
	const at = new Map(order.map((key, index) => [key, index]));
	return items.toSorted((a, b) => (at.get(keyOf(a)) ?? order.length) - (at.get(keyOf(b)) ?? order.length));
}

const BY_SORT: Record<Exclude<InboxSort, "manual">, (a: InboxPullRequest, b: InboxPullRequest) => number> = {
	updated: (a, b) => b.updatedAt - a.updatedAt,
	newest: (a, b) => b.number - a.number,
	oldest: (a, b) => a.number - b.number,
};

function sorted(pullRequests: InboxPullRequest[], { sort, manual }: InboxOrder): InboxPullRequest[] {
	if (sort !== "manual") return pullRequests.toSorted(BY_SORT[sort]);
	const at = new Map(manual.map((key, index) => [key, index]));
	return pullRequests.toSorted((a, b) => (at.get(prKey(a)) ?? -1) - (at.get(prKey(b)) ?? -1) || BY_SORT.updated(a, b));
}

/** The section titles in page order. */
export const sectionTitles = (order: InboxOrder): string[] => inOrder(SECTION_RULES, rule => rule.title, order.sections).map(rule => rule.title);

/** The inbox's repositories in page order. */
export const orderedRepos = <R extends Repo>(repos: readonly R[], order: InboxOrder): R[] => inOrder(repos, repoKey, order.repos);

/** A repository's pull requests in Graphite's inbox sections, leaving out the empty ones, each row with its place in a stack. */
export function inboxSections(pullRequests: InboxPullRequest[], order: InboxOrder = DEFAULT_ORDER): InboxSection[] {
	const members = stackMembers(pullRequests);
	const taken = Map.groupBy(sorted(pullRequests, order), sectionOf);
	return inOrder(SECTION_RULES, rule => rule.title, order.sections).flatMap((rule): InboxSection[] => {
		const prs = taken.get(rule);
		if (!prs) return [];
		const unitOf = (pr: InboxPullRequest): string => {
			const member = members.get(pr);
			return member ? `stack:${member.root}` : prKey(pr);
		};
		// A group keeps its first member's place, so a stack sits where its first member in the sort would.
		const groups = Map.groupBy(prs, unitOf);
		const ordered = [...groups.values()].flatMap(group => group.toSorted((a, b) => (members.get(b)?.position ?? 0) - (members.get(a)?.position ?? 0)));
		const rows = ordered.map((pr, at): InboxRow => {
			const member = members.get(pr);
			if (!member) return { pr, stack: null, unit: unitOf(pr) };
			const joins = (row: InboxPullRequest | undefined, step: number): boolean => {
				const other = row && members.get(row);
				return !!other && other.root === member.root && other.position === member.position + step;
			};
			return { pr, stack: { position: member.position, size: member.size, joinsAbove: joins(ordered[at - 1], 1), joinsBelow: joins(ordered[at + 1], -1) }, unit: unitOf(pr) };
		});
		return [{ title: rule.title, waiting: rule.waiting, rows }];
	});
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
export function placedManual(manual: readonly string[], repo: Repo, sections: InboxSection[], section: string, unit: string, target: string, where: Where): string[] {
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
export const foldedByDefault = (key: string): boolean => SECTION_RULES.some(rule => rule.folded && key.endsWith(`:${rule.title}`));

/** The pull requests the inbox shows, in its order: those of readable repositories and sections that `isFolded` leaves open. */
export function shownPullRequests({ repos }: Inbox, isFolded: (key: string) => boolean, order: InboxOrder = DEFAULT_ORDER): InboxPullRequest[] {
	return orderedRepos(repos, order).flatMap(repo => {
		const key = repoKey(repo);
		if ("error" in repo || isFolded(key)) return [];
		return inboxSections(repo.pullRequests, order).flatMap(({ title, rows }) => (isFolded(sectionFoldKey(key, title)) ? [] : rows.map(row => row.pr)));
	});
}

interface MergeFacts {
	state: PullRequestDetail["state"];
	review: ReviewDecision;
	conflicts: boolean;
	checks: CheckState;
	/** Some review thread waits for a resolution, or GitHub listed too few threads to tell. */
	threadsOpen: boolean;
}

/** Open, approved or needing no review, its checks passed or absent, no conflicts, and no review thread left open. */
const readyToMerge = ({ state, review, conflicts, checks, threadsOpen }: MergeFacts): boolean =>
	state === "open" && (review === "approved" || review === "none") && !conflicts && (checks === "passing" || checks === "none") && !threadsOpen;

/** What a row says after its reviewers: ready to merge, or a review decision its section does not already state. */
export type RowVerdict = "ready" | "approved" | "changes-requested" | null;

/**
 * A review decision shows only where the section leaves it unsaid: on a draft, or on a review asked of you. Your own open
 * pull request sits in the section that names its decision, so it says only whether it is ready to merge.
 */
export function rowVerdict(pr: InboxPullRequest): RowVerdict {
	if (pr.state === "merged") return null;
	if (pr.role === "author" && pr.state === "open") {
		const threadsOpen = pr.unresolved.count > 0 || !pr.unresolved.exact;
		return readyToMerge({ state: pr.state, review: pr.review, conflicts: pr.conflicts, checks: pr.checks, threadsOpen }) ? "ready" : null;
	}
	return pr.review === "approved" || pr.review === "changes-requested" ? pr.review : null;
}

/** How many of your pull requests in `inbox` are ready to merge. */
export const mergeableCount = ({ repos }: Inbox): number =>
	repos.flatMap(repo => ("error" in repo ? [] : repo.pullRequests)).filter(pr => rowVerdict(pr) === "ready").length;

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
	| { kind: "threads"; count: number }
	| { kind: "ready" };

/** What stands between an open or draft pull request and its merge, blockers first; nothing once it is merged or closed. */
export function pullRequestStatus(detail: PullRequestDetail): StatusItem[] {
	if (detail.state === "merged" || detail.state === "closed") return [];
	const count = (state: PullRequestDetail["checks"][number]["state"]): number => detail.checks.filter(check => check.state === state).length;
	const by = (state: PullRequestDetail["reviewers"][number]["state"]): string[] => detail.reviewers.filter(reviewer => reviewer.state === state).map(({ login }) => login);
	const failing = count("failing");
	const pending = count("pending");
	const checks: CheckState = failing > 0 ? "failing" : pending > 0 ? "pending" : detail.checks.length > 0 ? "passing" : "none";
	const items: StatusItem[] = [];
	if (readyToMerge({ state: detail.state, review: detail.review, conflicts: detail.conflicts, checks, threadsOpen: detail.threads.length > 0 })) items.push({ kind: "ready" });
	if (detail.state === "draft") items.push({ kind: "draft" });
	if (detail.conflicts) items.push({ kind: "conflicts", base: detail.base });
	if (failing > 0) items.push({ kind: "checks-failing", count: failing });
	if (detail.review === "changes-requested") items.push({ kind: "changes-requested", by: by("changes-requested") });
	if (detail.threads.length > 0) items.push({ kind: "threads", count: detail.threads.length });
	if (pending > 0) items.push({ kind: "checks-pending", count: pending });
	if (detail.review === "review-required") items.push({ kind: "review-required", waitingOn: by("requested") });
	if (detail.review === "approved") items.push({ kind: "approved", by: by("approved") });
	if (checks === "passing") items.push({ kind: "checks-passing", passed: count("passing"), skipped: count("skipped") });
	return items;
}
