import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { PLAIN_LAUNCH } from "../omp/rpc";
import type { SubmittedComment, SubmittedReview } from "../pull-request-review";
import { diffLinesOf, type ReviewDraft, type ReviewPayload } from "../shared/review-drafts";
import { newSessionRequest } from "../shared/sessions";
import type { ProjectJoin } from "./project-runner";
import { ReviewDrafts, type ReviewGitHub } from "./review-drafts";
import { ReviewDraftsFile } from "./review-drafts-file";

const HEAD = "a".repeat(40);
const pr = { owner: "acme", repo: "app", number: 7 };
const PATCH = ["@@ -1,2 +1,3 @@", " one", "+two", " three"].join("\n");

const dirs: string[] = [];
afterEach(() => {
	flushJsonFiles();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** GitHub as posting sees it: the head, the diff, the reviews on the pull request, and every post it took. */
function fakeGitHub(head = HEAD) {
	const reviews: SubmittedReview[] = [];
	const comments = new Map<number, SubmittedComment[]>();
	const posts: ReviewPayload[] = [];
	const github: ReviewGitHub = {
		target: async () => ({ head, lines: diffLinesOf([{ path: "src/a.ts", patch: PATCH }]) }),
		reviews: async () => reviews,
		reviewComments: async (_pr, id) => comments.get(id) ?? [],
		viewer: async () => "me",
		post: async (_pr, payload) => {
			posts.push(payload);
			const id = 100 + posts.length;
			reviews.push({ id, url: `https://github.com/acme/app/pull/7#pullrequestreview-${id}`, login: "me", commit: payload.commit_id, state: "COMMENTED", body: payload.body });
			comments.set(id, payload.comments.map(({ path, body }) => ({ path, body })));
			return { id, url: `https://github.com/acme/app/pull/7#pullrequestreview-${id}` };
		},
	};
	return { github, reviews, comments, posts };
}

function setup(github: ReviewGitHub = fakeGitHub().github) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-review-drafts-"));
	dirs.push(dir);
	const path = join(dir, "review-drafts.json");
	let changes = 0;
	const drafts = new ReviewDrafts({ file: new ReviewDraftsFile(path), github, now: () => 5_000, onChange: () => void changes++ });
	return { drafts, path, changes: () => changes };
}

const plainJoin: ProjectJoin = { rpc: PLAIN_LAUNCH, attach() {} };

const reviewStart = newSessionRequest("/tmp/app", "Review it", { subject: { kind: "pull-request", pr }, reviewDraft: true });

/** The review tool a Review start of `pr` gets, run as omp runs it. */
function saveTool(drafts: ReviewDrafts) {
	const tool = drafts.join(reviewStart, plainJoin).rpc.tools.find(candidate => candidate.name === "save_review_draft")!;
	return (params: Record<string, unknown>) => tool.execute(params, { toolCallId: "t1", signal: new AbortController().signal });
}

const review = { commit: HEAD, verdict: "comment", summary: "Close.", findings: [{ path: "./src/a.ts", line: 2, body: "Off by one." }, { path: "src/b.ts", line: null, body: "Missing test." }] };

describe("the save_review_draft tool", () => {
	test("only a Review start of a pull request, or the resume of its session, gets it", async () => {
		const { drafts } = setup();
		const plain = drafts.join(newSessionRequest("/tmp/app", "Hi", { subject: { kind: "pull-request", pr } }), plainJoin);
		expect(plain).toBe(plainJoin);
		const join = drafts.join(reviewStart, plainJoin);
		expect(join.rpc.tools.map(tool => tool.name)).toEqual(["save_review_draft"]);
		await join.attach({ instanceId: "i1", sessionId: "s1", cwd: "/tmp/app" });
		expect(drafts.join({ kind: "resume", sessionId: "s1" }, plainJoin).rpc.tools.map(tool => tool.name)).toEqual(["save_review_draft"]);
		drafts.switched("i1", "s2");
		expect(drafts.join({ kind: "resume", sessionId: "s1" }, plainJoin)).toBe(plainJoin);
		expect(drafts.join({ kind: "resume", sessionId: "s2" }, plainJoin).rpc.tools.map(tool => tool.name)).toEqual(["save_review_draft"]);
	});

	test("saves the draft of its pull request, every finding pending, and keeps it in the file", async () => {
		const { drafts, path, changes } = setup();
		expect(await saveTool(drafts)(review)).toBe(
			"Saved the review draft of acme/app#7: comment, 2 findings. It waits in the dashboard for the user to accept, edit, and post; do not post anything on GitHub.",
		);
		const expected: ReviewDraft = {
			pr,
			head: HEAD,
			verdict: "comment",
			summary: "Close.",
			findings: [
				{ id: "f1", path: "src/a.ts", line: 2, startLine: null, side: "RIGHT", body: "Off by one.", state: "pending", source: "review" },
				{ id: "f2", path: "src/b.ts", line: null, startLine: null, side: "RIGHT", body: "Missing test.", state: "pending", source: "review" },
			],
			savedAt: 5_000,
			posted: null,
		};
		expect(drafts.list).toEqual([expected]);
		expect(changes()).toBe(1);
		flushJsonFiles();
		expect(JSON.parse(readFileSync(path, "utf8")).drafts).toEqual([expected]);
		expect(await saveTool(drafts)({ ...review, findings: [] })).toStartWith("Replaced the review draft of acme/app#7: comment, 0 findings.");
	});

	test("refuses a short commit, an unknown verdict, and a finding on line 0, saving nothing", async () => {
		const { drafts } = setup();
		const save = saveTool(drafts);
		await expect(save({ ...review, commit: "abc1234" })).rejects.toThrow("commit must be the head commit's full 40-character id, in lowercase hex.");
		await expect(save({ ...review, verdict: "lgtm" })).rejects.toThrow("verdict must be one of approve, request-changes, comment.");
		await expect(save({ ...review, findings: [{ path: "a.ts", line: 0, body: "x" }] })).rejects.toThrow("findings[0].line must be a line number from 1, or null.");
		expect(drafts.list).toEqual([]);
	});
});

describe("local findings", () => {
	test("creates and appends through the dashboard edit store, saved at the server's time, and persists ranges without GitHub", () => {
		const unavailable = async (): Promise<never> => { throw new Error("A local draft must not call GitHub."); };
		const { drafts, path } = setup({ target: unavailable, reviews: unavailable, reviewComments: unavailable, viewer: unavailable, post: unavailable });
		expect(drafts.edit({ op: "add-finding", pr, head: HEAD, finding: { path: "src/a.ts", line: 2, startLine: 1, side: "LEFT", body: "Range." } })).toBe(true);
		expect(drafts.edit({ op: "add-finding", pr, head: HEAD, finding: { path: "src/a.ts", line: 3, startLine: null, side: "RIGHT", body: "Line." } })).toBe(true);
		expect(drafts.list[0]?.findings).toEqual([
			{ id: "f1", path: "src/a.ts", line: 2, startLine: 1, side: "LEFT", body: "Range.", state: "pending", source: "code" },
			{ id: "f2", path: "src/a.ts", line: 3, startLine: null, side: "RIGHT", body: "Line.", state: "pending", source: "code" },
		]);
		expect(drafts.list[0]?.savedAt).toBe(5_000);
		flushJsonFiles();
		expect(new ReviewDraftsFile(path).value.drafts).toEqual(drafts.list);
	});

	test("loads a finding saved before ranges as the session's, on one line on the head side", () => {
		const { path } = setup();
		const old = { id: "f1", path: "a.ts", line: 3, body: "Old.", state: "pending" };
		writeFileSync(path, JSON.stringify({ drafts: [{ pr, head: HEAD, verdict: "comment", summary: "", findings: [old], savedAt: 1, posted: null }], reviewers: [] }));
		expect(new ReviewDraftsFile(path).value.drafts[0]?.findings).toEqual([{ id: "f1", path: "a.ts", line: 3, startLine: null, side: "RIGHT", body: "Old.", state: "pending", source: "review" }]);
	});
});

describe("posting", () => {
	test("previews and submits a manually added range on the selected side in one review", async () => {
		const fake = fakeGitHub();
		fake.github.target = async () => ({
			head: HEAD,
			lines: diffLinesOf([{ path: "src/a.ts", patch: ["@@ -10,2 +20,2 @@", "-old one", "-old two", "+new one", "+new two"].join("\n") }]),
		});
		const { drafts } = setup(fake.github);
		drafts.edit({ op: "add-finding", pr, head: HEAD, finding: { path: "src/a.ts", startLine: 10, line: 11, side: "LEFT", body: "Removed range." } });
		drafts.edit({ op: "add-finding", pr, head: HEAD, finding: { path: "src/a.ts", startLine: 20, line: 21, side: "RIGHT", body: "Added range." } });
		drafts.edit({ op: "finding-state", pr, ids: ["f1", "f2"], state: "accepted" });
		const expected: ReviewPayload = {
			commit_id: HEAD, event: "COMMENT", body: "",
			comments: [
				{ path: "src/a.ts", start_line: 10, line: 11, start_side: "LEFT", side: "LEFT", body: "Removed range." },
				{ path: "src/a.ts", start_line: 20, line: 21, start_side: "RIGHT", side: "RIGHT", body: "Added range." },
			],
		};
		expect(await drafts.preview(pr)).toEqual({ head: HEAD, refusal: null, payload: expected });
		await drafts.post(pr);
		expect(fake.posts).toEqual([expected]);
	});

	const accept = (drafts: ReviewDrafts) => drafts.edit({ op: "finding-state", pr, ids: ["f1", "f2"], state: "accepted" });

	test("posts one review on the draft's head, comments on diff lines, and marks the draft posted", async () => {
		const fake = fakeGitHub();
		const { drafts } = setup(fake.github);
		await saveTool(drafts)(review);
		accept(drafts);
		const posted = await drafts.post(pr);
		expect(fake.posts).toEqual([
			{ commit_id: HEAD, event: "COMMENT", body: "Close.\n\n- `src/b.ts`: Missing test.", comments: [{ path: "src/a.ts", line: 2, side: "RIGHT", body: "Off by one." }] },
		]);
		expect(posted.posted).toEqual({ id: 101, url: "https://github.com/acme/app/pull/7#pullrequestreview-101", at: 5_000 });
		await expect(drafts.post(pr)).rejects.toThrow("This draft is posted already.");
		expect(fake.posts.length).toBe(1);
	});

	test("a double click posts once", async () => {
		const fake = fakeGitHub();
		const { drafts } = setup(fake.github);
		await saveTool(drafts)(review);
		accept(drafts);
		const [first, second] = await Promise.all([drafts.post(pr), drafts.post(pr)]);
		expect(fake.posts.length).toBe(1);
		expect(second).toBe(first);
	});

	test("a retry after a post whose answer was lost takes the review already on GitHub, and a thread reply's empty review is no match", async () => {
		const fake = fakeGitHub();
		const { drafts } = setup(fake.github);
		await saveTool(drafts)(review);
		accept(drafts);
		fake.reviews.push({ id: 50, url: "https://github.com/acme/app/pull/7#pullrequestreview-50", login: "me", commit: HEAD, state: "COMMENTED", body: "" });
		fake.reviews.push({ id: 60, url: "https://github.com/acme/app/pull/7#pullrequestreview-60", login: "me", commit: HEAD, state: "COMMENTED", body: "Close.\n\n- `src/b.ts`: Missing test." });
		fake.comments.set(60, [{ path: "src/a.ts", body: "Off by one." }]);
		const posted = await drafts.post(pr);
		expect(fake.posts).toEqual([]);
		expect(posted.posted).toEqual({ id: 60, url: "https://github.com/acme/app/pull/7#pullrequestreview-60", at: 5_000 });
	});

	test("an earlier review with other comments is no match, so the draft posts", async () => {
		const fake = fakeGitHub();
		const { drafts } = setup(fake.github);
		await saveTool(drafts)(review);
		accept(drafts);
		fake.reviews.push({ id: 60, url: "u", login: "me", commit: HEAD, state: "COMMENTED", body: "Close.\n\n- `src/b.ts`: Missing test." });
		fake.comments.set(60, [{ path: "src/a.ts", body: "Something else." }]);
		expect((await drafts.post(pr)).posted?.id).toBe(101);
		expect(fake.posts.length).toBe(1);
	});

	test("refuses a draft whose pull request moved, and previews why", async () => {
		const fake = fakeGitHub("b".repeat(40));
		const { drafts } = setup(fake.github);
		await saveTool(drafts)(review);
		accept(drafts);
		await expect(drafts.post(pr)).rejects.toThrow("The pull request moved from aaaaaaa to bbbbbbb since this review; run Review again on the new head.");
		expect(fake.posts).toEqual([]);
		expect((await drafts.preview(pr)).refusal).toBe("The pull request moved from aaaaaaa to bbbbbbb since this review; run Review again on the new head.");
	});

	test("a pull request without a draft has nothing to preview or post", async () => {
		const { drafts } = setup();
		await expect(drafts.preview(pr)).rejects.toThrow("acme/app#7 has no review draft.");
		await expect(drafts.post(pr)).rejects.toThrow("acme/app#7 has no review draft.");
	});
});
