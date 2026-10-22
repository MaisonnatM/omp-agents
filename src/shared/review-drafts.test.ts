import { describe, expect, test } from "bun:test";
import { applyReviewDraft, canSubmitReview, decodeReviewDraft, diffLinesOf, NO_REVIEW_DRAFTS, postRefusal, type ReviewDraft, type ReviewDraftState, type ReviewFinding, reviewPayload, submittedDraft } from "./review-drafts";

const HEAD = "a".repeat(40);
const pr = { owner: "acme", repo: "app", number: 7 };

const finding = (id: string, path: string, line: number | null, body: string, state: ReviewFinding["state"] = "pending"): ReviewFinding => ({ id, path, line, startLine: null, side: "RIGHT", body, state, source: "review" });

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
	test("adding a finding creates a local comment draft saved at the change's time, without a review session, its finding numbered f1", () => {
		const state = applyReviewDraft(NO_REVIEW_DRAFTS, {
			op: "add-finding", pr, head: HEAD, at: 3_000,
			finding: { path: "src/a.ts", line: 3, startLine: 2, side: "RIGHT", body: "Check this range." },
		});
		expect(state.drafts).toEqual([{
			pr, head: HEAD, verdict: "comment", summary: "", posted: null, savedAt: 3_000,
			findings: [{ id: "f1", path: "src/a.ts", line: 3, startLine: 2, side: "RIGHT", body: "Check this range.", state: "pending", source: "code" }],
		}]);
		expect(state.reviewers).toEqual([]);
	});

	test("adding appends after the highest finding number without losing existing edits", () => {
		const kept = [finding("f1", "src/a.ts", 1, "Accepted.", "accepted"), finding("f3", "src/b.ts", null, "Whole file.")];
		const original = saved({ verdict: "request-changes", summary: "Keep this.", findings: kept });
		const state = applyReviewDraft(original, { op: "add-finding", pr, head: HEAD, at: 3_000, finding: { path: "src/a.ts", line: 2, startLine: null, side: "LEFT", body: "Deleted line." } });
		expect(state.drafts).toEqual([draft({
			verdict: "request-changes", summary: "Keep this.",
			findings: [...kept, { id: "f4", path: "src/a.ts", line: 2, startLine: null, side: "LEFT", body: "Deleted line.", state: "pending", source: "code" }],
		})]);
	});

	test("adding to a draft on another head or a posted one throws why rather than replacing its findings", () => {
		const added = { path: "src/a.ts", line: 3, startLine: null, side: "RIGHT", body: "New." } as const;
		expect(() => applyReviewDraft(saved(), { op: "add-finding", pr, head: "b".repeat(40), at: 3_000, finding: added })).toThrow("The review draft is on aaaaaaa, not the head bbbbbbb; discard it to start a new one.");
		const posted = saved({ posted: { id: 9, url: "u", at: 2_000 } });
		expect(() => applyReviewDraft(posted, { op: "add-finding", pr, head: HEAD, at: 3_000, finding: added })).toThrow("The review draft is posted already; discard it to start a new one.");
	});

	test("finding edits set the range and side, and can return to a whole-file finding", () => {
		const state = applyReviewDraft(saved(), { op: "finding", pr, id: "f1", path: "src/a.ts", line: 3, startLine: 1, side: "LEFT", body: "Range." });
		expect(state.drafts[0]!.findings[0]).toEqual({ id: "f1", path: "src/a.ts", line: 3, startLine: 1, side: "LEFT", body: "Range.", state: "pending", source: "review" });
		const whole = applyReviewDraft(state, { op: "finding", pr, id: "f1", path: "src/a.ts", line: null, startLine: null, side: "RIGHT", body: "Whole file." });
		expect(whole.drafts[0]!.findings[0]).toEqual({ id: "f1", path: "src/a.ts", line: null, startLine: null, side: "RIGHT", body: "Whole file.", state: "pending", source: "review" });
	});

	test("edits change the verdict, the summary, a finding, and finding states; an edit that changes nothing keeps the state", () => {
		let state = saved();
		state = applyReviewDraft(state, { op: "verdict", pr, verdict: "approve" });
		state = applyReviewDraft(state, { op: "summary", pr, summary: "Ship it." });
		state = applyReviewDraft(state, { op: "finding", pr, id: "f1", path: "src/a.ts", line: 4, startLine: null, side: "RIGHT", body: "Off by one here." });
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

	test("a save keeps the comments written from Code on the same unposted head, numbered after the session's findings", () => {
		let state = applyReviewDraft(saved(), { op: "add-finding", pr, head: HEAD, at: 3_000, finding: { path: "src/a.ts", line: 5, startLine: null, side: "RIGHT", body: "Mine." } });
		state = applyReviewDraft(state, { op: "finding-state", pr, ids: ["f3"], state: "accepted" });
		const again = applyReviewDraft(state, { op: "save", draft: draft({ findings: [finding("f1", "src/c.ts", 9, "New finding.")], savedAt: 5_000 }) });
		expect(again.drafts[0]!.findings).toEqual([
			finding("f1", "src/c.ts", 9, "New finding."),
			{ id: "f2", path: "src/a.ts", line: 5, startLine: null, side: "RIGHT", body: "Mine.", state: "accepted", source: "code" },
		]);
		expect(applyReviewDraft(state, { op: "save", draft: draft({ head: "b".repeat(40), findings: [] }) }).drafts[0]!.findings).toEqual([]);
		const posted = applyReviewDraft(state, { op: "posted", pr, head: HEAD, review: { id: 9, url: "u", at: 4_000 } });
		expect(applyReviewDraft(posted, { op: "save", draft: draft({ findings: [] }) }).drafts[0]!.findings).toEqual([]);
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
	test("holds both sides' lines, including deleted lines, and none for a file without a patch", () => {
		const lines = diffLinesOf([
			{ path: "src/a.ts", patch: PATCH },
			{ path: "logo.png", patch: null },
		]);
		expect([...lines.get("src/a.ts")!.RIGHT]).toEqual([1, 2, 3, 4]);
		expect([...lines.get("src/a.ts")!.LEFT]).toEqual([1, 2, 3]);
		expect([...lines.get("logo.png")!.RIGHT]).toEqual([]);
		expect([...lines.get("logo.png")!.LEFT]).toEqual([]);
	});
});

describe("reviewPayload", () => {
	test("preserves ranges and deletion sides only when every selected line is on that side of the diff", () => {
		const patch = ["@@ -10,3 +20,3 @@", "-old one", "-old two", "+new one", "+new two", " context", "@@ -30 +40 @@", " later"].join("\n");
		const lines = diffLinesOf([{ path: "a.ts", patch }]);
		const payload = reviewPayload(draft({
			summary: "",
			findings: [
				{ id: "left", path: "a.ts", startLine: 10, line: 11, side: "LEFT", body: "Deleted range.", state: "accepted", source: "code" },
				{ id: "right", path: "a.ts", startLine: 20, line: 21, side: "RIGHT", body: "Added range.", state: "accepted", source: "code" },
				{ id: "single", path: "a.ts", line: 10, startLine: null, side: "LEFT", body: "Deleted line.", state: "accepted", source: "code" },
				{ id: "same", path: "a.ts", startLine: 20, line: 20, side: "RIGHT", body: "One line.", state: "accepted", source: "code" },
				{ id: "wrong", path: "a.ts", line: 20, startLine: null, side: "LEFT", body: "Wrong side.", state: "accepted", source: "code" },
				{ id: "gap", path: "a.ts", startLine: 22, line: 40, side: "RIGHT", body: "Hidden lines.", state: "accepted", source: "code" },
				{ id: "start", path: "a.ts", startLine: 19, line: 21, side: "RIGHT", body: "Start outside.", state: "accepted", source: "code" },
			],
		}), lines);
		expect(payload.comments).toEqual([
			{ path: "a.ts", line: 11, side: "LEFT", start_line: 10, start_side: "LEFT", body: "Deleted range." },
			{ path: "a.ts", line: 21, side: "RIGHT", start_line: 20, start_side: "RIGHT", body: "Added range." },
			{ path: "a.ts", line: 10, side: "LEFT", body: "Deleted line." },
			{ path: "a.ts", line: 20, side: "RIGHT", body: "One line." },
		]);
		expect(payload.body).toBe("- `a.ts:20 (base)`: Wrong side.\n- `a.ts:22-40`: Hidden lines.\n- `a.ts:19-21`: Start outside.");
	});

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

describe("submittedDraft", () => {
	test("sets the verdict and summary and accepts the pending findings, leaving the dismissed ones", () => {
		const before = draft({ findings: [finding("f1", "x.ts", 1, "Nit.", "pending"), finding("f2", "y.ts", 2, "No.", "dismissed")] });
		const after = submittedDraft(before, { verdict: "approve", summary: "Ship it." });
		expect([after.verdict, after.summary, after.findings.map(item => item.state)]).toEqual(["approve", "Ship it.", ["accepted", "dismissed"]]);
		expect(before.findings.map(item => item.state)).toEqual(["pending", "dismissed"]);
	});

	test("answers the draft itself when the submit changes nothing", () => {
		const same = draft({ verdict: "comment", summary: "Hi.", findings: [finding("f1", "x.ts", 1, "Nit.", "accepted")] });
		expect(submittedDraft(same, { verdict: "comment", summary: "Hi." })).toBe(same);
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
		expect(postRefusal(draft({ verdict: "approve", summary: "" }), HEAD)).toBeNull();
	});
});

describe("canSubmitReview", () => {
	test("an approval always submits, a change request needs a summary, and a comment needs a summary or a line comment", () => {
		expect([
			canSubmitReview("approve", "", 0),
			canSubmitReview("request-changes", "", 2),
			canSubmitReview("request-changes", " Fix it. ", 0),
			canSubmitReview("comment", "  ", 0),
			canSubmitReview("comment", "", 1),
			canSubmitReview("comment", "Nice.", 0),
		]).toEqual([true, false, true, false, true, true]);
	});
});

describe("decodeReviewDraft", () => {
	test("reads a finding saved before ranges as the session's, on one line on the head side, keeps a range, and refuses an unknown side", () => {
		const old = { id: "f1", path: "a.ts", line: 3, body: "Old.", state: "pending" };
		expect(decodeReviewDraft({ ...draft(), findings: [old] })).toEqual(draft({ findings: [finding("f1", "a.ts", 3, "Old.")] }));
		const range: ReviewFinding = { id: "f1", path: "a.ts", line: 3, startLine: 1, side: "LEFT", body: "Range.", state: "pending", source: "code" };
		expect(decodeReviewDraft(draft({ findings: [range] }))).toEqual(draft({ findings: [range] }));
		expect(decodeReviewDraft({ ...draft(), findings: [{ ...old, side: "BASE" }] })).toBeNull();
	});
});
