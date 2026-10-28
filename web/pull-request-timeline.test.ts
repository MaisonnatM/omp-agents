import { describe, expect, test } from "bun:test";
import type { Person, PullRequestComment, PullRequestCommit, PullRequestDetail, PullRequestEvent, PullRequestThread } from "../src/shared/github";
import { approvalCount, timelineRows, type TimelineRow } from "./pull-request-timeline";

const ann: Person = { login: "ann", avatarUrl: null };

const detail = (fields: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
	owner: "acme",
	repo: "webapp",
	number: 7,
	title: "PR 7",
	body: "",
	author: ann,
	reviewers: [],
	state: "open",
	review: "review-required",
	head: "ann/branch-7",
	base: "main",
	conflicts: false,
	additions: 0,
	deletions: 0,
	changedFiles: 0,
	files: [],
	checks: "none",
	checkRuns: [],
	unresolved: { count: 0, exact: true, bots: 0 },
	threads: [],
	conversation: [],
	createdAt: 0,
	updatedAt: 0,
	mergedAt: null,
	closedAt: null,
	labels: [],
	commits: [],
	headOid: "",
	mergeMethods: [],
	mergeState: "clean",
	behindBy: null,
	canComment: false,
	byViewer: false,
	viewerApproved: false,
	...fields,
});

const comment = (body: string, at: number): PullRequestComment => ({ author: ann, body, at, url: `https://github.com/acme/webapp/pull/7#${body}`, reactions: [] });
const event = (body: string, at: number, review: PullRequestEvent["review"] = null): PullRequestEvent => ({ ...comment(body, at), review });
const commit = (sha: string, at: number): PullRequestCommit => ({ oid: sha.padEnd(40, "0"), sha, at, author: ann, headline: `Commit ${sha}`, additions: 1, deletions: 0 });
const thread = (id: string, comments: PullRequestComment[], resolved = false): PullRequestThread => ({
	id,
	path: "src/app.ts",
	line: 7,
	resolved,
	outdated: false,
	dismissed: false,
	can: { reply: true, resolve: true, unresolve: true },
	commentCount: comments.length,
	comments,
});

function shown(rows: TimelineRow[]) {
	return rows.map(row => {
		switch (row.kind) {
			case "comments": return ["comments", row.at, ...row.events.map(item => item.body)];
			case "commit": return ["commit", row.at, row.commit.sha];
			case "review": return ["review", row.at, row.verdict, row.event.body];
			case "thread": return ["thread", row.at, row.thread.id, row.thread.resolved, row.root.body, ...row.replies.map(item => item.body)];
			case "lifecycle": return [row.state, row.at, row.author?.login ?? null];
			case "new": return ["new", row.at];
		}
	});
}

describe("timeline rows", () => {
	test("plain comments and commented reviews group consecutively in the selected order", () => {
		const pr = detail({ conversation: [event("third", 30), event("first", 10), event("second", 20, "commented")] });
		expect(shown(timelineRows(pr, false, null))).toEqual([
			["opened", 0, "ann"],
			["comments", 10, "first", "second", "third"],
		]);
		expect(shown(timelineRows(pr, true, null))).toEqual([
			["comments", 30, "third", "second", "first"],
			["opened", 0, "ann"],
		]);
	});

	test("interleaving happens before grouping so a commit splits comments, and each commit is its own row", () => {
		const pr = detail({
			commits: [commit("d", 60), commit("a", 10), commit("c", 50), commit("b", 20)],
			conversation: [event("after", 70), event("middle", 30), event("also-middle", 40)],
		});
		expect(shown(timelineRows(pr, false, null))).toEqual([
			["opened", 0, "ann"],
			["commit", 10, "a"],
			["commit", 20, "b"],
			["comments", 30, "middle", "also-middle"],
			["commit", 50, "c"],
			["commit", 60, "d"],
			["comments", 70, "after"],
		]);
		expect(shown(timelineRows(pr, true, null))).toEqual([
			["comments", 70, "after"],
			["commit", 60, "d"],
			["commit", 50, "c"],
			["comments", 40, "also-middle", "middle"],
			["commit", 20, "b"],
			["commit", 10, "a"],
			["opened", 0, "ann"],
		]);
	});

	test("a thread's first comment is its root and the rest its replies, resolved threads included, and empty threads drop out", () => {
		const pr = detail({
			conversation: [event("before", 5), event("after", 40)],
			threads: [
				thread("resolved", [comment("root", 10), comment("reply", 90)], true),
				thread("empty", [], true),
				thread("open", [comment("open-root", 20)]),
				thread("also-empty", []),
			],
		});
		expect(shown(timelineRows(pr, false, null))).toEqual([
			["opened", 0, "ann"],
			["comments", 5, "before"],
			["thread", 10, "resolved", true, "root", "reply"],
			["thread", 20, "open", false, "open-root"],
			["comments", 40, "after"],
		]);
		expect(shown(timelineRows(pr, true, null))).toEqual([
			["comments", 40, "after"],
			["thread", 20, "open", false, "open-root"],
			["thread", 10, "resolved", true, "root", "reply"],
			["comments", 5, "before"],
			["opened", 0, "ann"],
		]);
	});

	test("approvals, change requests, and dismissals remain individual review rows and split conversation groups", () => {
		const pr = detail({ conversation: [
			event("before", 10),
			event("", 20, "approved"),
			event("fix this", 30, "changes-requested"),
			event("dismissed review", 40, "dismissed"),
			event("after", 50, "commented"),
		] });
		expect(shown(timelineRows(pr, false, null))).toEqual([
			["opened", 0, "ann"],
			["comments", 10, "before"],
			["review", 20, "approved", ""],
			["review", 30, "changes-requested", "fix this"],
			["review", 40, "dismissed", "dismissed review"],
			["comments", 50, "after"],
		]);
		expect(shown(timelineRows(pr, true, null))).toEqual([
			["comments", 50, "after"],
			["review", 40, "dismissed", "dismissed review"],
			["review", 30, "changes-requested", "fix this"],
			["review", 20, "approved", ""],
			["comments", 10, "before"],
			["opened", 0, "ann"],
		]);
	});

	test("merged takes precedence over closed, closure timestamps may be zero, and an open pull request only opened", () => {
		expect(shown(timelineRows(detail({ mergedAt: 20, closedAt: 30 }), false, null))).toEqual([
			["opened", 0, "ann"],
			["merged", 20, null],
		]);
		expect(shown(timelineRows(detail({ mergedAt: null, closedAt: 30 }), true, null))).toEqual([
			["closed", 30, null],
			["opened", 0, "ann"],
		]);
		expect(shown(timelineRows(detail({ createdAt: -10, mergedAt: 0, closedAt: 30 }), true, null))).toEqual([
			["merged", 0, null],
			["opened", -10, "ann"],
		]);
		expect(shown(timelineRows(detail({ createdAt: -10, closedAt: 0 }), true, null))).toEqual([
			["closed", 0, null],
			["opened", -10, "ann"],
		]);
		expect(shown(timelineRows(detail(), true, null))).toEqual([["opened", 0, "ann"]]);
	});

	test("same-time activity retains source order oldest first and reverses that order newest first", () => {
		const pr = detail({
			createdAt: 10,
			commits: [commit("second-listed", 10), commit("first-listed", 10)],
			conversation: [event("second-listed", 10), event("first-listed", 10), event("approved", 10, "approved")],
			threads: [thread("second-listed", [comment("root-b", 10)]), thread("first-listed", [comment("root-a", 10)])],
			mergedAt: 10,
		});
		expect(shown(timelineRows(pr, false, null))).toEqual([
			["opened", 10, "ann"],
			["commit", 10, "second-listed"],
			["commit", 10, "first-listed"],
			["comments", 10, "second-listed", "first-listed"],
			["review", 10, "approved", "approved"],
			["thread", 10, "second-listed", false, "root-b"],
			["thread", 10, "first-listed", false, "root-a"],
			["merged", 10, null],
		]);
		expect(shown(timelineRows(pr, true, null))).toEqual([
			["merged", 10, null],
			["thread", 10, "first-listed", false, "root-a"],
			["thread", 10, "second-listed", false, "root-b"],
			["review", 10, "approved", "approved"],
			["comments", 10, "first-listed", "second-listed"],
			["commit", 10, "first-listed"],
			["commit", 10, "second-listed"],
			["opened", 10, "ann"],
		]);
	});

	test("sorting and reversing do not change the detail or the activity objects it owns", () => {
		const pr = detail({
			commits: [commit("later", 30), commit("earlier", 10)],
			conversation: [event("later", 60), event("earlier", 50)],
			threads: [thread("thread", [comment("root", 40), comment("reply", 100)])],
		});
		Object.freeze(pr.commits);
		Object.freeze(pr.conversation);
		Object.freeze(pr.threads);
		for (const item of pr.commits) Object.freeze(item);
		for (const item of pr.conversation) Object.freeze(item);
		for (const item of pr.threads) {
			Object.freeze(item.comments);
			Object.freeze(item);
		}
		timelineRows(pr, true, null);
		timelineRows(pr, false, null);
		expect(pr.commits.map(item => item.sha)).toEqual(["later", "earlier"]);
		expect(pr.conversation.map(item => item.body)).toEqual(["later", "earlier"]);
		expect(pr.threads[0]?.comments.map(item => item.body)).toEqual(["root", "reply"]);
	});

	test("a conversation group keeps its oldest comment's key in either order", () => {
		const pr = detail({ conversation: [event("first", 10), event("second", 20)] });
		const keys = [false, true].map(newestFirst => timelineRows(pr, newestFirst, null).flatMap(row => (row.kind === "comments" ? [row.key] : [])));
		expect(keys).toEqual([["comments:https://github.com/acme/webapp/pull/7#first:0"], ["comments:https://github.com/acme/webapp/pull/7#first:0"]]);
	});
});

describe("review staleness and approvals", () => {
	const by = (login: string, at: number, review: PullRequestEvent["review"]): PullRequestEvent => ({ ...event(`${login}-${at}`, at, review), author: { login, avatarUrl: null } });

	test("a verdict from before the newest commit is stale, a dismissal never is, and without commits none is", () => {
		const stale = (pr: PullRequestDetail) => timelineRows(pr, false, null).flatMap(row => (row.kind === "review" ? [[row.event.body, row.stale]] : []));
		const conversation = [by("ann", 30, "approved"), by("bob", 10, "dismissed"), by("cat", 40, "changes-requested")];
		expect(stale(detail({ commits: [commit("a", 20), commit("b", 40)], conversation }))).toEqual([["bob-10", false], ["ann-30", true], ["cat-40", false]]);
		expect(stale(detail({ conversation }))).toEqual([["bob-10", false], ["ann-30", false], ["cat-40", false]]);
	});

	test("approvals count each reviewer's latest verdict once, when it approves and is not stale", () => {
		const conversation = [
			by("ann", 50, "changes-requested"),
			by("ann", 10, "approved"),
			by("bob", 20, "approved"),
			by("bob", 60, "commented"),
			by("cat", 5, "approved"),
			by("dan", 30, "approved"),
			by("dan", 40, "dismissed"),
			by("eve", 25, "approved"),
			by("eve", 26, "approved"),
		];
		expect(approvalCount(detail({ commits: [commit("a", 15)], conversation }))).toBe(2);
		expect(approvalCount(detail({ conversation }))).toBe(3);
	});
});

describe("timeline unread boundary", () => {
	test("read and unread comments never group together, with activity at the seen time already read", () => {
		const pr = detail({ conversation: [event("read", 10), event("seen", 20), event("new", 30), event("newest", 40)] });
		expect(shown(timelineRows(pr, false, 20))).toEqual([
			["opened", 0, "ann"],
			["comments", 10, "read", "seen"],
			["new", 20],
			["comments", 30, "new", "newest"],
		]);
		expect(shown(timelineRows(pr, true, 20))).toEqual([
			["comments", 40, "newest", "new"],
			["new", 20],
			["comments", 20, "seen", "read"],
			["opened", 0, "ann"],
		]);
	});

	test("all-new activity still gets a marker below newest-first rows or above oldest-first rows", () => {
		const pr = detail({ createdAt: 10, conversation: [event("new", 20), event("newest", 30)] });
		expect(shown(timelineRows(pr, false, 0))).toEqual([
			["new", 0],
			["opened", 10, "ann"],
			["comments", 20, "new", "newest"],
		]);
		expect(shown(timelineRows(pr, true, 0))).toEqual([
			["comments", 30, "newest", "new"],
			["opened", 10, "ann"],
			["new", 0],
		]);
	});

	test("a first visit or a visit with no new activity shows no marker in either direction", () => {
		const pr = detail({ conversation: [event("earlier", 10), event("latest", 20)] });
		for (const seen of [null, 20, 30]) {
			expect(shown(timelineRows(pr, false, seen))).toEqual([
				["opened", 0, "ann"],
				["comments", 10, "earlier", "latest"],
			]);
			expect(shown(timelineRows(pr, true, seen))).toEqual([
				["comments", 20, "latest", "earlier"],
				["opened", 0, "ann"],
			]);
		}
	});
});
