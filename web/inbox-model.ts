/** Pull request links, the inbox page's sections and stacks, and what stands between a pull request and its merge. */
import type { CheckState, Inbox, InboxPullRequest, PullRequest, PullRequestDetail, ReviewDecision } from "../src/shared";
import { type SectionTarget, sectionId } from "./section";

export const pullRequestUrl = (pr: PullRequest): string => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

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
}

export interface InboxSection {
	title: string;
	waiting: Waiting | null;
	/** Most recently updated first, except that a stack's members in the section sit together, top first, where its most recently updated member would. */
	rows: InboxRow[];
}

interface StackMember {
	/** The head branch of the stack's bottom pull request, which names the stack. */
	root: string;
	depth: number;
	size: number;
}

/** Each open or draft pull request in a stack of two or more that the inbox lists, by the chain of base branches. */
function stackMembers(pullRequests: InboxPullRequest[]): Map<InboxPullRequest, StackMember> {
	const live = pullRequests.filter(pr => pr.state !== "merged");
	const byHead = new Map(live.map(pr => [pr.head, pr]));
	const places = new Map<InboxPullRequest, { root: string; depth: number }>();
	const placeOf = (pr: InboxPullRequest, seen: Set<InboxPullRequest>): { root: string; depth: number } => {
		const known = places.get(pr);
		if (known) return known;
		seen.add(pr);
		const below = pr.stackedOn === null ? undefined : byHead.get(pr.stackedOn);
		// GitHub cannot report a cycle of bases, but one must not hang the page.
		const under = below && !seen.has(below) ? placeOf(below, seen) : null;
		const place = under ? { root: under.root, depth: under.depth + 1 } : { root: pr.head, depth: 1 };
		places.set(pr, place);
		return place;
	};
	for (const pr of live) placeOf(pr, new Set());
	const stacks = new Map<string, { members: number; size: number }>();
	for (const { root, depth } of places.values()) {
		const stack = stacks.get(root) ?? { members: 0, size: 0 };
		stacks.set(root, { members: stack.members + 1, size: Math.max(stack.size, depth) });
	}
	const members = new Map<InboxPullRequest, StackMember>();
	for (const [pr, place] of places) {
		const stack = stacks.get(place.root)!;
		if (stack.members > 1) members.set(pr, { ...place, size: stack.size });
	}
	return members;
}

/** A repository's pull requests in Graphite's inbox sections, leaving out the empty ones, each row with its place in a stack. */
export function inboxSections(pullRequests: InboxPullRequest[]): InboxSection[] {
	const members = stackMembers(pullRequests);
	const taken = SECTION_RULES.map((): InboxPullRequest[] => []);
	for (const pr of pullRequests.toSorted((a, b) => b.updatedAt - a.updatedAt)) {
		taken[SECTION_RULES.findIndex(({ takes }) => takes(pr))]?.push(pr);
	}
	return SECTION_RULES.flatMap(({ title, waiting }, index): InboxSection[] => {
		const prs = taken[index]!;
		if (prs.length === 0) return [];
		const ordered: InboxPullRequest[] = [];
		for (const pr of prs) {
			if (ordered.includes(pr)) continue;
			const root = members.get(pr)?.root;
			if (root === undefined) ordered.push(pr);
			else ordered.push(...prs.filter(other => members.get(other)?.root === root).toSorted((a, b) => members.get(b)!.depth - members.get(a)!.depth));
		}
		const rows = ordered.map((pr, at): InboxRow => {
			const member = members.get(pr);
			if (!member) return { pr, stack: null };
			const joins = (row: InboxPullRequest | undefined, step: number): boolean => {
				const other = row && members.get(row);
				return !!other && other.root === member.root && other.depth === member.depth + step;
			};
			return { pr, stack: { position: member.depth, size: member.size, joinsAbove: joins(ordered[at - 1], 1), joinsBelow: joins(ordered[at + 1], -1) } };
		});
		return [{ title, waiting, rows }];
	});
}

/** A repository's fold key, or one of its sections'; the inbox page keeps them in localStorage. A repository's name holds no `:`. */
export const sectionFoldKey = (repo: string, title: string): string => `${repo}:${title}`;

/** Whether the inbox folds the repository or section that `key` names until you unfold it. */
export function foldedByDefault(key: string): boolean {
	const title = key.slice(key.indexOf(":") + 1);
	return key.includes(":") && SECTION_RULES.some(rule => rule.folded && rule.title === title);
}

/** A section of the inbox page, by `repoKey` and title, which a sidebar link scrolls to. Its title is folded under the repository. */
export const inboxSection = (repo: string, title: string): SectionTarget => ({
	id: sectionId("inbox", repo, title),
	folds: [repo, sectionFoldKey(repo, title)],
});

/** How many pull requests in `inbox` wait on your move: reviews asked of you and pull requests returned to you. */
export function waitingCount({ repos }: Inbox): number {
	return repos.reduce(
		(total, repo) => total + ("error" in repo ? 0 : inboxSections(repo.pullRequests).filter(section => section.waiting !== null).reduce((sum, { rows }) => sum + rows.length, 0)),
		0,
	);
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
		return readyToMerge({ ...pr, threadsOpen: pr.unresolved.count > 0 || !pr.unresolved.exact }) ? "ready" : null;
	}
	return pr.review === "approved" || pr.review === "changes-requested" ? pr.review : null;
}

/** One fact about where a pull request stands, as its sheet's Status lists it. */
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
	if (readyToMerge({ ...detail, checks, threadsOpen: detail.threads.length > 0 })) items.push({ kind: "ready" });
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
