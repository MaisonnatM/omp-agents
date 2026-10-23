import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { PullRequestRebase, PullRequestSummary, RebasedPullRequest } from "../src/shared/github";
import { toasts } from "./components/toaster";
import { type RebaseHooks, type RebaseJob, rebasePullRequest, rebasePullRequests } from "./pull-request-rebases";

const pr = (number: number, stackedOn: number | null = null): PullRequestSummary => ({
	owner: "acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	author: { login: "me", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 0,
	deletions: 0,
	head: `me/branch-${number}`,
	base: stackedOn === null ? "main" : `me/branch-${stackedOn}`,
	stackedOn: stackedOn === null ? null : `me/branch-${stackedOn}`,
	behind: true,
	unresolved: { count: 0, exact: true },
	conversations: 0,
	updatedAt: number,
});

const job = (number: number, stackedOn: number | null = null): RebaseJob => ({ pr: pr(number, stackedOn), cwd: "/work/webapp" });

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The server's answer to each pull request number. */
let answers: Record<number, Response>;
let requested: PullRequestRebase[];
let toasted: { title?: unknown; description?: unknown }[];

beforeEach(() => {
	requested = [];
	toasted = [];
	spyOn(globalThis, "fetch").mockImplementation((async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as PullRequestRebase;
		requested.push(body);
		return answers[body.number]!;
	}) as typeof fetch);
	spyOn(toasts, "add").mockImplementation(toast => {
		toasted.push({ title: toast.title, description: toast.description });
		return "";
	});
});

afterEach(() => mock.restore());

/** Runs `queue` and resolves once the run reads the list again, with the jobs handed to **Resolve conflicts**. */
function settled(queue: (hooks: RebaseHooks) => void): Promise<RebaseJob[]> {
	const resolved: RebaseJob[] = [];
	const { promise, resolve } = Promise.withResolvers<RebaseJob[]>();
	queue({ resolve: job => resolved.push(job), refresh: () => resolve(resolved) });
	return promise;
}

const rebased = (branch: string, kind: RebasedPullRequest["kind"] = "rebased"): RebasedPullRequest =>
	kind === "conflict" ? { kind, branch, onto: "main", files: ["a.ts", "b.ts"] } : { kind, branch, onto: "main" };

describe("rebasePullRequest", () => {
	test("toasts the server's reason for a refusal", async () => {
		answers = { 1: reply(409, { error: "The worktree has uncommitted changes." }) };
		expect(await settled(hooks => rebasePullRequest(job(1), hooks))).toEqual([]);
		expect(toasted).toEqual([{ title: "Could not rebase me/branch-1", description: "The worktree has uncommitted changes." }]);
	});
});

describe("rebasePullRequests", () => {
	test("hands a conflict to Resolve conflicts, skips the stack above it, and sums the run up once", async () => {
		answers = { 1: reply(200, rebased("me/branch-1", "conflict")), 4: reply(200, rebased("me/branch-4", "current")), 5: reply(200, rebased("me/branch-5")) };
		const resolved = await settled(hooks => rebasePullRequests([job(1), job(4), job(2, 1), job(3, 2), job(5)], hooks));
		expect(resolved).toEqual([job(1)]);
		expect(requested.map(({ number }) => number)).toEqual([1, 4, 5]);
		expect(toasted).toEqual([
			{ title: "me/branch-1 conflicts with main", description: "2 files conflict. A Resolve conflicts session takes over." },
			{ title: "Rebased me/branch-5 on main", description: undefined },
			{ title: "Rebased 1 of 5 pull requests", description: "1 already had its base, 1 stopped at a conflict, and 2 skipped, stacked on one that stopped." },
		]);
	});

	test("rebases what sits on a pull request once it is pushed", async () => {
		answers = { 1: reply(200, rebased("me/branch-1")), 2: reply(200, rebased("me/branch-2")) };
		await settled(hooks => rebasePullRequests([job(1), job(2, 1)], hooks));
		expect(requested.map(({ number }) => number)).toEqual([1, 2]);
		expect(toasted.at(-1)).toEqual({ title: "Rebased 2 of 2 pull requests", description: undefined });
	});
});
