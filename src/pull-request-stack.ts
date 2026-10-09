/**
 * The stack a pull request's details show, live from `gh`: as Graphite does, every open pull request of its repository
 * chained to it by base branches, whoever opened them, not only those the inbox lists.
 */
import { createCache } from "./cache";
import { AVATAR, authorOf, dataOf, ghGraphql, STATUS } from "./github";
import { isObject, str } from "./json";
import { type PullRequest, type Repo, repoKey, type StackedPullRequest, samePullRequest } from "./shared/github";

const OPEN_QUERY = `query($owner: String!, $repo: String!, $endCursor: String) {
	repository(owner: $owner, name: $repo) { pullRequests(states: OPEN, first: 100, after: $endCursor) {
		nodes {
			number title isDraft isCrossRepository headRefName baseRefName updatedAt author { login ${AVATAR} }
			commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
		}
		pageInfo { hasNextPage endCursor }
	} }
}`;

function parseOpen(node: unknown, { owner, repo }: Repo): StackedPullRequest | null {
	// A fork's branch lives in another repository, so no pull request here stacks on it.
	if (!isObject(node) || typeof node.number !== "number" || node.isCrossRepository === true) return null;
	const title = str(node.title);
	const head = str(node.headRefName);
	const base = str(node.baseRefName);
	const updatedAt = Date.parse(str(node.updatedAt) ?? "");
	if (title === undefined || head === undefined || base === undefined || Number.isNaN(updatedAt)) return null;
	const commits = isObject(node.commits) && Array.isArray(node.commits.nodes) ? node.commits.nodes : [];
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? str(commit.statusCheckRollup.state) : undefined;
	return {
		owner,
		repo,
		number: node.number,
		title,
		author: authorOf(node.author),
		state: node.isDraft === true ? "draft" : "open",
		checks: STATUS[rollup ?? ""] ?? "none",
		head,
		base,
		updatedAt,
	};
}

/** The open pull requests in `gh api graphql --paginate --slurp`'s answer to `OPEN_QUERY`: one answer per page. */
export function parseOpenAnswer(answer: unknown, repo: Repo): StackedPullRequest[] {
	return (Array.isArray(answer) ? answer : [answer]).flatMap(page => {
		const repository = dataOf(page).repository;
		const connection = isObject(repository) ? repository.pullRequests : null;
		const nodes = isObject(connection) && Array.isArray(connection.nodes) ? connection.nodes : [];
		return nodes.flatMap(node => parseOpen(node, repo) ?? []);
	});
}

/**
 * The pull requests of `open` stacked with `pr`, by the chain of base branches, top first; empty when `pr` is not
 * open or nothing stacks with it. Pull requests stacked on the same branch follow each other above it, lowest number first.
 */
export function stackOf(open: StackedPullRequest[], pr: PullRequest): StackedPullRequest[] {
	const self = open.find(other => samePullRequest(other, pr));
	if (!self) return [];
	const byHead = new Map(open.map(other => [other.head, other]));
	const byBase = Map.groupBy(open.toSorted((a, b) => a.number - b.number), other => other.base);
	// GitHub cannot report a cycle of bases, but one must not hang the read.
	const seen = new Set([self]);
	const below: StackedPullRequest[] = [];
	for (let next = byHead.get(self.base); next && !seen.has(next); next = byHead.get(next.base)) {
		seen.add(next);
		below.push(next);
	}
	const above: StackedPullRequest[] = [];
	const climb = (from: StackedPullRequest): void => {
		for (const next of byBase.get(from.head) ?? []) {
			if (seen.has(next)) continue;
			seen.add(next);
			above.push(next);
			climb(next);
		}
	};
	climb(self);
	if (seen.size < 2) return [];
	return [...above.toReversed(), self, ...below];
}

const opened = createCache<StackedPullRequest[]>();

/** `pr`'s stack, top first, from its repository's open pull requests, which the server keeps for 30 seconds. */
export async function loadPullRequestStack(pr: PullRequest): Promise<StackedPullRequest[]> {
	const open = await opened.get(repoKey(pr), async () => parseOpenAnswer(await ghGraphql(OPEN_QUERY, { owner: pr.owner, repo: pr.repo }, true), pr));
	return stackOf(open, pr);
}
