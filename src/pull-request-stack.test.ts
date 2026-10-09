import { expect, test } from "bun:test";
import { parseOpenAnswer, stackOf } from "./pull-request-stack";
import type { StackedPullRequest } from "./shared/github";

const repo = { owner: "acme", repo: "webapp" };

const stacked = (number: number, below: number | null): StackedPullRequest => ({
	...repo,
	number,
	title: `PR ${number}`,
	author: { login: "someone", avatarUrl: null },
	state: "open",
	checks: "none",
	head: `branch-${number}`,
	base: below === null ? "main" : `branch-${below}`,
	updatedAt: 0,
});

test("a pull request's stack runs top first along the chain of bases, siblings above it lowest number first, and one alone has none", () => {
	const open = [stacked(1, null), stacked(3, 2), stacked(2, 1), stacked(5, 1), stacked(6, 4), stacked(7, null)];
	const numbers = (number: number) => stackOf(open, { ...repo, number }).map(({ number }) => number);
	expect(numbers(1)).toEqual([5, 3, 2, 1]);
	expect(numbers(2)).toEqual([3, 2, 1]);
	expect(numbers(6)).toEqual([]);
	expect(numbers(7)).toEqual([]);
	expect(numbers(9)).toEqual([]);
});

test("a fork's pull request named like a branch here stacks nothing on it, across every page of the answer", () => {
	const node = (number: number, head: string, base: string, isCrossRepository = false) => ({
		number,
		title: `PR ${number}`,
		isDraft: number === 2,
		isCrossRepository,
		headRefName: head,
		baseRefName: base,
		updatedAt: "2026-10-01T00:00:00Z",
		author: null,
		commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
	});
	const page = (...nodes: unknown[]) => ({ data: { repository: { pullRequests: { nodes } } } });
	const open = parseOpenAnswer([page(node(1, "feature", "main"), node(9, "main", "main", true)), page(node(2, "on-feature", "feature"))], repo);
	expect(open.map(({ number, state, checks, author }) => [number, state, checks, author.login])).toEqual([
		[1, "open", "passing", "ghost"],
		[2, "draft", "passing", "ghost"],
	]);
	expect(stackOf(open, { ...repo, number: 1 }).map(({ number }) => number)).toEqual([2, 1]);
});
