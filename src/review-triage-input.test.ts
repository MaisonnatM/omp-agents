import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecked } from "./proc";
import { changedPaths, readTriageCode, readTriageGitHub, sourceVersion } from "./review-triage-input";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const pr = { owner: "acme", repo: "app", number: 7 };
const HEAD = "a".repeat(40);

const comment = (id: string) => ({ id, body: `Body ${id}.`, updatedAt: "2026-01-01T00:00:00Z", url: `https://github.com/acme/app/pull/7#${id}`, author: { login: "rev" } });
const connection = (nodes: unknown[], total: number, after: string | null) => ({ totalCount: total, pageInfo: { hasNextPage: after !== null, endCursor: after }, nodes });
const thread = (id: string, comments: ReturnType<typeof connection>) => ({ id, path: "src/a.ts", line: 4, isResolved: id === "T2", comments });
const threadsPage = (threads: ReturnType<typeof connection>, head = HEAD) => ({ data: { repository: { pullRequest: { headRefOid: head, headRefName: "feature", reviewThreads: threads } } } });
const reviewsPage = (reviews: ReturnType<typeof connection>) => ({ data: { repository: { pullRequest: { headRefOid: HEAD, reviews } } } });
const review = (id: string, body = `Review ${id}.`) => ({ ...comment(id), body, state: "CHANGES_REQUESTED" });

/** GitHub as the triage capture queries it: answers by the cursors each query sends. */
function fakeQuery(answer: (vars: Record<string, string | number>) => unknown, reviewAnswer = (_vars: Record<string, string | number>) => reviewsPage(connection([], 0, null))) {
	const calls: Record<string, string | number>[] = [];
	return { calls, query: async (query: string, vars: Record<string, string | number>) => (calls.push(vars), query.includes("reviews(first:") ? reviewAnswer(vars) : answer(vars)) };
}

describe("readTriageGitHub", () => {
	test("reads every page of threads and every page of a long thread's comments, resolved threads included", async () => {
		const { query, calls } = fakeQuery(vars => {
			if (vars.id === "T1") return { data: { node: { comments: connection([comment("C2")], 2, null) } } };
			if (vars.after === "p2") return threadsPage(connection([thread("T2", connection([comment("C3")], 1, null))], 2, null));
			return threadsPage(connection([thread("T1", connection([comment("C1")], 2, "c2"))], 2, "p2"));
		});
		const input = await readTriageGitHub(pr, query);
		expect(input.head).toBe(HEAD);
		expect(input.sources.map(source => (source.kind === "thread" ? [source.id, source.resolved, source.comments.map(each => each.id)] : null))).toEqual([
			["T1", false, ["C1", "C2"]],
			["T2", true, ["C3"]],
		]);
		expect(calls).toEqual([{ owner: "acme", repo: "app", number: 7 }, { id: "T1", commentsAfter: "c2" }, { owner: "acme", repo: "app", number: 7, after: "p2" }, { owner: "acme", repo: "app", number: 7 }]);
	});

	test("refuses a capture whose thread count disagrees with the pages it read", async () => {
		const { query } = fakeQuery(() => threadsPage(connection([thread("T1", connection([comment("C1")], 1, null))], 3, null)));
		await expect(readTriageGitHub(pr, query)).rejects.toThrow("Threads changed during capture");
	});

	test("refuses a repeated thread cursor rather than reading forever", async () => {
		let page = 0;
		const { query } = fakeQuery(() => threadsPage(connection([thread(`T${++page}`, connection([comment(`C${page}`)], 1, null))], 9, "same")));
		await expect(readTriageGitHub(pr, query)).rejects.toThrow("repeated a thread cursor");
	});

	test("refuses a pull request whose head moved between pages", async () => {
		const { query } = fakeQuery(vars => threadsPage(connection([thread(vars.after ? "T2" : "T1", connection([comment("C1")], 1, null))], 2, vars.after ? null : "p2"), vars.after ? "b".repeat(40) : HEAD));
		await expect(readTriageGitHub(pr, query)).rejects.toThrow("moved during capture");
	});

	test("paginates review bodies with no threads and excludes empty inline-only review bodies", async () => {
		const { query } = fakeQuery(
			() => threadsPage(connection([], 0, null)),
			vars => vars.after === "r2" ? reviewsPage(connection([review("R2", ""), review("R3")], 3, null)) : reviewsPage(connection([review("R1")], 3, "r2")),
		);
		const input = await readTriageGitHub(pr, query);
		expect(input.sources).toEqual([
			{ kind: "review", id: "R1", body: "Review R1.", author: "rev", state: "CHANGES_REQUESTED", updatedAt: "2026-01-01T00:00:00Z", url: "https://github.com/acme/app/pull/7#R1" },
			{ kind: "review", id: "R3", body: "Review R3.", author: "rev", state: "CHANGES_REQUESTED", updatedAt: "2026-01-01T00:00:00Z", url: "https://github.com/acme/app/pull/7#R3" },
		]);
		const edited = fakeQuery(() => threadsPage(connection([], 0, null)), () => reviewsPage(connection([{ ...review("R1"), updatedAt: "later" }, review("R2", ""), review("R3")], 3, null)));
		expect(sourceVersion((await readTriageGitHub(pr, edited.query)).sources)).not.toBe(sourceVersion(input.sources));
	});

	test("refuses incomplete review counts and repeated review cursors", async () => {
		const incomplete = fakeQuery(() => threadsPage(connection([], 0, null)), () => reviewsPage(connection([review("R1")], 2, null)));
		await expect(readTriageGitHub(pr, incomplete.query)).rejects.toThrow("Reviews changed during capture");
		let count = 0;
		const repeated = fakeQuery(() => threadsPage(connection([], 0, null)), () => reviewsPage(connection([review(`R${++count}`)], 4, "same")));
		await expect(readTriageGitHub(pr, repeated.query)).rejects.toThrow("repeated a review cursor");
	});
});

describe("a checkout's reviewed code", () => {
	async function repo(): Promise<string> {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-triage-")));
		dirs.push(dir);
		const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
		await runChecked(["git", "init", "-q", "-b", "main"], { cwd: dir });
		writeFileSync(join(dir, "a.ts"), "one\n");
		writeFileSync(join(dir, "b.ts"), "clean\n");
		await runChecked(["git", "add", "a.ts", "b.ts"], { cwd: dir });
		await runChecked(["git", "commit", "-q", "-m", "one"], { cwd: dir, env });
		return dir;
	}

	test("a change since the review leaves out work that was already dirty then and is untouched", async () => {
		const dir = await repo();
		writeFileSync(join(dir, "a.ts"), "user work\n");
		writeFileSync(join(dir, "notes.txt"), "staged\n");
		await runChecked(["git", "add", "notes.txt"], { cwd: dir });
		writeFileSync(join(dir, "scratch.txt"), "mine\n");
		const reviewed = await readTriageCode(dir);
		expect([reviewed.dirty.map(each => each.path), reviewed.untracked.map(each => each.path)]).toEqual([["a.ts", "notes.txt"], ["scratch.txt"]]);
		expect([...changedPaths(reviewed, await readTriageCode(dir))]).toEqual([]);
		writeFileSync(join(dir, "b.ts"), "fixed\n");
		writeFileSync(join(dir, "added.ts"), "new\n");
		expect([...changedPaths(reviewed, await readTriageCode(dir))].sort()).toEqual(["added.ts", "b.ts"]);
		writeFileSync(join(dir, "a.ts"), "user work, then fixed\n");
		rmSync(join(dir, "scratch.txt"));
		expect([...changedPaths(reviewed, await readTriageCode(dir))].sort()).toEqual(["a.ts", "added.ts", "b.ts", "scratch.txt"]);
	});

	test("changes when staged, unstaged, or untracked work changes", async () => {
		const dir = await repo();
		const clean = await readTriageCode(dir);
		expect(await readTriageCode(dir)).toEqual(clean);
		writeFileSync(join(dir, "a.ts"), "two\n");
		const unstaged = await readTriageCode(dir);
		expect(unstaged.worktree).not.toBe(clean.worktree);
		await runChecked(["git", "add", "a.ts"], { cwd: dir });
		const staged = await readTriageCode(dir);
		expect([staged.index === clean.index, staged.worktree === clean.worktree]).toEqual([false, true]);
		writeFileSync(join(dir, "new.ts"), "x\n");
		const untracked = await readTriageCode(dir);
		expect(untracked.untracked.map(each => each.path)).toEqual(["new.ts"]);
		writeFileSync(join(dir, "new.ts"), "y\n");
		expect((await readTriageCode(dir)).untracked).not.toEqual(untracked.untracked);
	});
});
