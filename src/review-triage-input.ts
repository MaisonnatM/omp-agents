import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { canonical, git, worktreesOf } from "./git";
import { dataOf, ghGraphql, repoOf } from "./github";
import { isObject } from "./json";
import { runChecked } from "./proc";
import type { PullRequest } from "./shared/github";
import { isTriageSource, type TriageCode, type TriageSource } from "./shared/review-triage";

export const triageDigest = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
export const sourceVersion = (sources: TriageSource[]): string => triageDigest(JSON.stringify([...sources].sort((a, b) => a.id.localeCompare(b.id))));
type Query = (query: string, variables: Record<string, string | number>) => Promise<unknown>;
const COMMENTS = "comments(first:100,after:$commentsAfter){totalCount pageInfo{hasNextPage endCursor} nodes{id body updatedAt url author{login}}}";
const THREADS = `query($owner:String!,$repo:String!,$number:Int!,$after:String,$commentsAfter:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid headRefName reviewThreads(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{id path line isResolved ${COMMENTS}}}}}}`;
const MORE_COMMENTS = `query($id:ID!,$commentsAfter:String){node(id:$id){... on PullRequestReviewThread{${COMMENTS}}}}`;
const REVIEWS = `query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid reviews(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{id body state updatedAt url author{login}}}}}}`;

function object(value: unknown, name: string): Record<string, unknown> {
	if (!isObject(value)) throw new Error(`GitHub omitted ${name}; triage capture is incomplete.`);
	return value;
}
function page(value: unknown): { nodes: unknown[]; total: number; after: string | null } {
	const connection = object(value, "a connection");
	const info = object(connection.pageInfo, "pageInfo");
	if (!Array.isArray(connection.nodes) || !Number.isSafeInteger(connection.totalCount) || typeof info.hasNextPage !== "boolean" || info.hasNextPage && typeof info.endCursor !== "string") throw new Error("GitHub returned an incomplete triage page.");
	return { nodes: connection.nodes, total: connection.totalCount as number, after: info.hasNextPage ? info.endCursor as string : null };
}
function data(answer: unknown): Record<string, unknown> {
	if (isObject(answer) && Array.isArray(answer.errors) && answer.errors.length) throw new Error(`GitHub refused complete triage capture: ${JSON.stringify(answer.errors)}`);
	return dataOf(answer);
}
export interface TriageGitHubInput { head: string; branch: string; sources: TriageSource[] }

/** Every review body, thread, and comment, including resolved feedback and stable edit identities. */
export async function readTriageGitHub(pr: PullRequest, query: Query = ghGraphql): Promise<TriageGitHubInput> {
	const sources: TriageSource[] = [];
	let head = "", branch = "", after: string | null = null;
	const cursors = new Set<string>();
	do {
		const vars: Record<string, string | number> = { owner: pr.owner, repo: pr.repo, number: pr.number };
		if (after !== null) vars.after = after;
		const repository = object(data(await query(THREADS, vars)).repository, "repository");
		const pull = object(repository.pullRequest, "pull request");
		if (typeof pull.headRefOid !== "string" || typeof pull.headRefName !== "string") throw new Error("GitHub omitted the reviewed head.");
		if (head && head !== pull.headRefOid) throw new Error("The pull request moved during capture. Read the triage again.");
		head = pull.headRefOid; branch = pull.headRefName;
		const threads = page(pull.reviewThreads);
		for (const value of threads.nodes) {
			const thread = object(value, "thread");
			let comments = page(thread.comments);
			const all = [...comments.nodes];
			const seen = new Set<string>();
			while (comments.after !== null) {
				if (seen.has(comments.after)) throw new Error("GitHub repeated a comment cursor.");
				seen.add(comments.after);
				if (typeof thread.id !== "string") throw new Error("GitHub omitted a thread id.");
				comments = page(object(data(await query(MORE_COMMENTS, { id: thread.id, commentsAfter: comments.after })).node, "thread").comments);
				all.push(...comments.nodes);
			}
			if (all.length !== comments.total) throw new Error("Comments changed during capture. Read the triage again.");
			const source: unknown = { kind: "thread", id: thread.id, path: thread.path, line: thread.line, resolved: thread.isResolved, comments: all.map(value => {
				const comment = object(value, "comment");
				return { id: comment.id, body: comment.body, author: isObject(comment.author) && typeof comment.author.login === "string" ? comment.author.login : "ghost", updatedAt: comment.updatedAt, url: comment.url };
			}) };
			if (!isTriageSource(source) || source.kind !== "thread" || new Set(source.comments.map(comment => comment.id)).size !== all.length) throw new Error("GitHub returned invalid or duplicate feedback.");
			sources.push(source);
		}
		after = threads.after;
		if (after !== null) {
			if (cursors.has(after)) throw new Error("GitHub repeated a thread cursor.");
			cursors.add(after);
		} else if (sources.length !== threads.total || new Set(sources.map(source => source.id)).size !== sources.length) throw new Error("Threads changed during capture. Read the triage again.");
	} while (after !== null);
	after = null;
	cursors.clear();
	const reviewIds = new Set<string>();
	do {
		const vars: Record<string, string | number> = { owner: pr.owner, repo: pr.repo, number: pr.number };
		if (after !== null) vars.after = after;
		const pull = object(object(data(await query(REVIEWS, vars)).repository, "repository").pullRequest, "pull request");
		if (pull.headRefOid !== head) throw new Error("The pull request moved during capture. Read the triage again.");
		const reviews = page(pull.reviews);
		for (const value of reviews.nodes) {
			const review = object(value, "review");
			if (typeof review.id !== "string" || !review.id || reviewIds.has(review.id) || typeof review.body !== "string") throw new Error("GitHub returned invalid or duplicate reviews.");
			reviewIds.add(review.id);
			if (!review.body.trim()) continue;
			const source: unknown = {
				kind: "review", id: review.id, body: review.body,
				author: isObject(review.author) && typeof review.author.login === "string" ? review.author.login : "ghost",
				state: review.state, updatedAt: review.updatedAt, url: review.url,
			};
			if (!isTriageSource(source)) throw new Error("GitHub returned invalid review feedback.");
			sources.push(source);
		}
		after = reviews.after;
		if (after !== null) {
			if (cursors.has(after)) throw new Error("GitHub repeated a review cursor.");
			cursors.add(after);
		} else if (reviewIds.size !== reviews.total) throw new Error("Reviews changed during capture. Read the triage again.");
	} while (after !== null);
	if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error("GitHub returned duplicate source identities.");
	return { head, branch, sources: sources.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** The checkout's head, digests of its staged and unstaged diffs, and the worktree content of each path that differs from the head, staged, unstaged, or untracked. */
export async function readTriageCode(cwd: string): Promise<TriageCode> {
	const top = (await git(cwd, "rev-parse", "--show-toplevel")).trim();
	const [head, index, worktree, staged, unstaged, others] = await Promise.all([
		git(top, "rev-parse", "HEAD"),
		git(top, "diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--"),
		git(top, "diff", "--binary", "--no-ext-diff", "--no-textconv", "--"),
		git(top, "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"),
		git(top, "diff", "--name-only", "--no-renames", "-z", "--"),
		git(top, "ls-files", "--others", "--exclude-standard", "-z"),
	]);
	const digests = (paths: string[]) => Promise.all([...new Set(paths.filter(Boolean))].sort().map(async path => ({ path, digest: await fileDigest(join(top, path)) })));
	const [dirty, untracked] = await Promise.all([digests([...staged.split("\0"), ...unstaged.split("\0")]), digests(others.split("\0"))]);
	return { head: head.trim(), index: triageDigest(index), worktree: triageDigest(worktree), dirty, untracked };
}

async function fileDigest(file: string): Promise<string> {
	const stat = await lstat(file).catch(() => null);
	if (!stat) return "deleted";
	return triageDigest(stat.isSymbolicLink() ? `link:${await readlink(file)}` : await readFile(file));
}

/**
 * The paths whose worktree content differs between two reads of one checkout at the same head. A path absent from a
 * read's `dirty` and `untracked` holds the head's content, so a file already dirty when reviewed counts only if it changed again.
 */
export function changedPaths(reviewed: TriageCode, now: TriageCode): Set<string> {
	const contents = (code: TriageCode) => new Map([...code.dirty, ...code.untracked].map(({ path, digest }) => [path, digest]));
	const before = contents(reviewed);
	const after = contents(now);
	return new Set([...before.keys(), ...after.keys()].filter(path => before.get(path) !== after.get(path)));
}

/** A pull request's checkout at its head: `cwd` itself when already there, else a detached worktree beside the main one. It never resets or stashes the user's checkout. */
export async function triageCheckout(cwd: string, pr: PullRequest, input: TriageGitHubInput, id: string): Promise<string> {
	const repo = await repoOf(cwd);
	if (!repo || repo.owner.toLowerCase() !== pr.owner.toLowerCase() || repo.repo.toLowerCase() !== pr.repo.toLowerCase()) throw new Error("The selected workspace is not this pull request's repository.");
	if ((await git(cwd, "rev-parse", "HEAD")).trim() === input.head) return canonical(cwd);
	const main = (await worktreesOf(cwd))[0]?.path;
	if (!main) throw new Error("The selected workspace is not a Git checkout.");
	await runChecked(["git", "-C", cwd, "fetch", "--quiet", "origin", input.head], { timeoutMs: 120_000 });
	const path = `${main}-review-triage-${id.slice(0, 8)}`;
	await git(cwd, "worktree", "add", "--detach", "--", path, input.head);
	return canonical(path);
}
