import { describe, expect, test } from "bun:test";
import { applyReviewDraft, diffLinesOf, NO_REVIEW_DRAFTS, postRefusal, type ReviewDraft, type ReviewDraftState, type ReviewFinding, reviewPayload } from "./review-drafts";

const HEAD = "a".repeat(40);
const pr = { owner: "acme", repo: "app", number: 7 };

const finding = (id: string, path: string, line: number | null, body: string, state: ReviewFinding["state"] = "pending"): ReviewFinding => ({ id, path, line, body, state });

const draft = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({
	pr,
	head: HEAD,
	verdict: "comment",
	summary: "Looks close.",
	findings: [finding("f1", "src/a.ts", 3, "Off by one."), finding("f2", "src/b.ts", null, "Missing test.")],
	savedAt: 1_000,
	posted: null,
	...over,
});

const saved = (over: Partial<ReviewDraft> = {}): ReviewDraftState => applyReviewDraft(NO_REVIEW_DRAFTS, { op: "save", draft: draft(over) });

describe("applyReviewDraft", () => {
	test("edits change the verdict, the summary, a finding, and finding states; an edit that changes nothing keeps the state", () => {
		let state = saved();
		state = applyReviewDraft(state, { op: "verdict", pr, verdict: "approve" });
		state = applyReviewDraft(state, { op: "summary", pr, summary: "Ship it." });
		state = applyReviewDraft(state, { op: "finding", pr, id: "f1", path: "src/a.ts", line: 4, body: "Off by one here." });
		state = applyReviewDraft(state, { op: "finding-state", pr, ids: ["f1", "f2"], state: "accepted" });
		expect(state.drafts).toEqual([
			draft({
				verdict: "approve",
				summary: "Ship it.",
				findings: [finding("f1", "src/a.ts", 4, "Off by one here.", "accepted"), finding("f2", "src/b.ts", null, "Missing test.", "accepted")],
			}),
		]);
		expect(applyReviewDraft(state, { op: "finding-state", pr, ids: ["f1"], state: "accepted" })).toBe(state);
		expect(applyReviewDraft(state, { op: "verdict", pr: { ...pr, number: 8 }, verdict: "comment" })).toBe(state);
	});

	test("a save replaces the pull request's draft, edits and all, and drops drafts posted two weeks before it", () => {
		const posted = applyReviewDraft(saved({ pr: { ...pr, number: 1 } }), { op: "posted", pr: { ...pr, number: 1 }, head: HEAD, review: { id: 9, url: "u", at: 2_000 } });
		let state = applyReviewDraft(posted, { op: "save", draft: draft() });
		state = applyReviewDraft(state, { op: "summary", pr, summary: "Edited." });
		state = applyReviewDraft(state, { op: "save", draft: draft({ summary: "Again.", savedAt: 5_000 }) });
		expect(state.drafts.map(({ pr: { number }, summary }) => [number, summary])).toEqual([
			[1, "Looks close."],
			[7, "Again."],
		]);
		const later = applyReviewDraft(state, { op: "save", draft: draft({ savedAt: 2_000 + 14 * 24 * 3_600_000 + 1 }) });
		expect(later.drafts.map(({ pr: { number } }) => number)).toEqual([7]);
	});

	test("posted marks the draft only on the head it was written against, once, and a posted draft takes no edits but a discard", () => {
		const state = saved();
		expect(applyReviewDraft(state, { op: "posted", pr, head: "b".repeat(40), review: { id: 1, url: "u", at: 2 } })).toBe(state);
		const posted = applyReviewDraft(state, { op: "posted", pr, head: HEAD, review: { id: 1, url: "u", at: 2 } });
		expect(posted.drafts[0]!.posted).toEqual({ id: 1, url: "u", at: 2 });
		expect(applyReviewDraft(posted, { op: "posted", pr, head: HEAD, review: { id: 2, url: "v", at: 3 } })).toBe(posted);
		expect(applyReviewDraft(posted, { op: "summary", pr, summary: "Late." })).toBe(posted);
		expect(applyReviewDraft(posted, { op: "discard", pr }).drafts).toEqual([]);
	});

	test("a session binds to one pull request, and a relink moves its binding to its new id", () => {
		let state = applyReviewDraft(NO_REVIEW_DRAFTS, { op: "bind", reviewer: { sessionId: "s1", pr } });
		state = applyReviewDraft(state, { op: "bind", reviewer: { sessionId: "s1", pr: { ...pr, number: 8 } } });
		state = applyReviewDraft(state, { op: "relink", from: "s1", to: "s2" });
		expect(state.reviewers).toEqual([{ sessionId: "s2", pr: { ...pr, number: 8 } }]);
		expect(applyReviewDraft(state, { op: "relink", from: "s1", to: "s3" })).toBe(state);
	});
});

const PATCH = ["@@ -1,3 +1,4 @@", " one", "-two", "+two!", "+three", " four"].join("\n");

describe("diffLinesOf", () => {
	test("holds the head-side lines each patch shows, and none for a file without a patch", () => {
		const lines = diffLinesOf([
			{ path: "src/a.ts", patch: PATCH },
			{ path: "logo.png", patch: null },
		]);
		expect([...lines.get("src/a.ts")!]).toEqual([1, 2, 3, 4]);
		expect([...lines.get("logo.png")!]).toEqual([]);
	});
});

describe("reviewPayload", () => {
	test("accepted findings on diff lines become comments; the other accepted ones fold under the summary; pending and dismissed stay out", () => {
		const lines = diffLinesOf([{ path: "src/a.ts", patch: PATCH }]);
		const payload = reviewPayload(
			draft({
				verdict: "request-changes",
				summary: "  Two things.  ",
				findings: [
					finding("f1", "src/a.ts", 3, "Off by one.", "accepted"),
					finding("f2", "src/a.ts", 40, "Outside the diff.\nSecond line.", "accepted"),
					finding("f3", "src/b.ts", null, "Missing test.", "accepted"),
					finding("f4", "src/a.ts", 2, "Still thinking.", "pending"),
					finding("f5", "src/a.ts", 1, "Not this.", "dismissed"),
				],
			}),
			lines,
		);
		expect(payload).toEqual({
			commit_id: HEAD,
			event: "REQUEST_CHANGES",
			body: "Two things.\n\n- `src/a.ts:40`: Outside the diff.\n  Second line.\n- `src/b.ts`: Missing test.",
			comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: "Off by one." }],
		});
	});

	test("with no summary the folded findings are the whole body", () => {
		const payload = reviewPayload(draft({ verdict: "approve", summary: "", findings: [finding("f1", "x.ts", 1, "Nit.", "accepted")] }), new Map());
		expect(payload).toEqual({ commit_id: HEAD, event: "APPROVE", body: "- `x.ts:1`: Nit.", comments: [] });
	});
});

describe("postRefusal", () => {
	test("refuses a posted draft, a moved head, changes requested without a summary, and nothing to say; else allows", () => {
		const accepted = [finding("f1", "x.ts", 1, "Nit.", "accepted")];
		expect(postRefusal(draft({ posted: { id: 1, url: "u", at: 2 } }), HEAD)).toBe("This draft is posted already.");
		expect(postRefusal(draft(), "b".repeat(40))).toBe("The pull request moved from aaaaaaa to bbbbbbb since this review; run Review again on the new head.");
		expect(postRefusal(draft({ verdict: "request-changes", summary: " ", findings: accepted }), HEAD)).toBe("Requesting changes needs a summary.");
		expect(postRefusal(draft({ summary: "" }), HEAD)).toBe("Accept a finding or write a summary first.");
		expect(postRefusal(draft({ summary: "", findings: accepted }), HEAD)).toBeNull();
		expect(postRefusal(draft({ verdict: "request-changes" }), HEAD)).toBeNull();
	});
});
