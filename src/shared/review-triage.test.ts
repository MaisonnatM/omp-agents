import { describe, expect, test } from "bun:test";
import { completeTriage, editReviewTriage, latestReviewTriage, parseTriageApply, replyOf, reserveTriage, type ReviewTriage, type TriageItem, type TriageResult, type TriageSnapshot } from "./review-triage";

const SNAPSHOT: TriageSnapshot = { code: { head: "a".repeat(40), index: "i", worktree: "w", dirty: [], untracked: [] }, sourceVersion: "v1" };

function item(id: string, verdict: TriageItem["assessment"]["verdict"], decision: TriageItem["decision"] = "pending"): TriageItem {
	return {
		id,
		source: { kind: "thermo", id, number: Number(id.slice(1)), reportId: "s1", path: "src/a.ts", line: 3, body: `Finding ${id}.` },
		assessment: { verdict, rationale: "Because.", evidence: "src/a.ts:3", reply: `Reply ${id}.` },
		decision,
		reply: null,
		replyRevision: 0,
	};
}

function triage(items: TriageItem[]): ReviewTriage {
	return { id: "t1", revision: 1, target: { kind: "local-session", sessionId: "s1" }, cwd: "/tmp/app", mode: "thermo", origin: null, snapshot: SNAPSHOT, sources: [], items, summary: "", capture: "{}", savedAt: 1, batch: null };
}

function running(held: ReviewTriage, checked = true): ReviewTriage {
	return { ...held, batch: { ...held.batch!, application: { phase: "running", sessionId: "s2", instanceId: "i2", checked } } };
}

const note = (findingId: string) => ({ kind: "thermo-note", reportId: "s1", findingId }) as const;

describe("editReviewTriage", () => {
	test("refuses an edit made against an older revision", () => {
		expect(() => editReviewTriage(triage([item("f1", "fix")]), { id: "t1", revision: 0, itemId: "f1", op: "decision", decision: "accepted" })).toThrow("This triage changed.");
	});

	test("refuses a decision once a batch froze the selection, and still takes reply wording", () => {
		const reserved = reserveTriage(triage([item("f1", "fix", "accepted")]), 1, "b1", 9, SNAPSHOT);
		expect(() => editReviewTriage(reserved, { id: "t1", revision: 2, itemId: "f1", op: "decision", decision: "dismissed" })).toThrow("frozen");
		const reworded = editReviewTriage(reserved, { id: "t1", revision: 2, itemId: "f1", op: "reply", text: "Later wording." });
		expect(reworded.items[0]?.reply).toBe("Later wording.");
		expect(reworded.batch?.selected[0]?.reply).toBe("Reply f1.");
	});
});

describe("reserveTriage", () => {
	test("freezes only the accepted items, with each one's edited reply and destination", () => {
		const held = triage([item("f1", "fix", "accepted"), item("f2", "push-back", "accepted"), item("f3", "fix"), item("f4", "already-done", "dismissed")]);
		const edited = editReviewTriage(held, { id: "t1", revision: 1, itemId: "f2", op: "reply", text: "Edited reply." });
		const reserved = reserveTriage(edited, 2, "b1", 9, SNAPSHOT);
		expect(reserved.batch).toEqual({
			id: "b1",
			revision: 2,
			at: 9,
			application: { phase: "reserved" },
			selected: [
				{ id: "f1", source: held.items[0]!.source, assessment: held.items[0]!.assessment, reply: "Reply f1.", replyRevision: 0, destination: note("f1") },
				{ id: "f2", source: held.items[1]!.source, assessment: held.items[1]!.assessment, reply: "Edited reply.", replyRevision: 1, destination: note("f2") },
			],
		});
	});

	test("refuses with nothing accepted, and when the code moved since the review", () => {
		expect(() => reserveTriage(triage([item("f1", "fix"), item("f2", "fix", "dismissed")]), 1, "b1", 9, SNAPSHOT)).toThrow("Accept at least one");
		expect(() => reserveTriage(triage([item("f1", "fix", "accepted")]), 1, "b1", 9, { ...SNAPSHOT, code: { ...SNAPSHOT.code, worktree: "changed" } })).toThrow("Code or feedback changed");
	});

	test("returns the batch it already holds rather than a second one", () => {
		const reserved = reserveTriage(triage([item("f1", "fix", "accepted")]), 1, "b1", 9, SNAPSHOT);
		expect(reserveTriage(reserved, 1, "b2", 10, SNAPSHOT)).toBe(reserved);
	});
});

describe("completeTriage", () => {
	const fixed: TriageResult = { id: "f1", outcome: "fixed", changedFiles: ["src/a.ts"], evidence: "bun test passes.", reply: "Fixed.", destination: note("f1") };
	const replied: TriageResult = { id: "f2", outcome: "reply-only", evidence: "Already handled at src/a.ts:9.", reply: "Done earlier.", destination: note("f2") };
	const batch = () => running(reserveTriage(triage([item("f1", "fix", "accepted"), item("f2", "already-done", "accepted")]), 1, "b1", 9, SNAPSHOT));

	test("saves one result per selected item, after which the card shows the result's reply", () => {
		const done = completeTriage(batch(), [fixed, replied]);
		expect(done.batch?.application).toEqual({ phase: "completed", sessionId: "s2", instanceId: "i2", results: [fixed, replied] });
		expect(replyOf(done.items[0]!, done)).toBe("Fixed.");
	});

	test("pre-apply wording enters the batch but the completed application's final draft is displayed", () => {
		const edited = editReviewTriage(triage([item("f1", "fix", "accepted")]), { id: "t1", revision: 1, itemId: "f1", op: "reply", text: "Please explain the fix." });
		const reserved = reserveTriage(edited, edited.revision, "b1", 9, SNAPSHOT);
		expect(reserved.batch?.selected.map(item => [item.reply, item.replyRevision])).toEqual([["Please explain the fix.", 1]]);
		const done = completeTriage(running(reserved), [fixed]);
		expect([done.items[0]!.reply, replyOf(done.items[0]!, done)]).toEqual(["Please explain the fix.", "Fixed."]);
	});

	test("wording edited during application overrides the final draft without changing its evidence", () => {
		const active = running(reserveTriage(triage([item("f1", "fix", "accepted")]), 1, "b1", 9, SNAPSHOT));
		const edited = editReviewTriage(active, { id: "t1", revision: active.revision, itemId: "f1", op: "reply", text: "My concurrent wording." });
		const done = completeTriage(edited, [fixed]);
		expect(replyOf(done.items[0]!, done)).toBe("My concurrent wording.");
		expect(done.batch?.application).toEqual({ phase: "completed", sessionId: "s2", instanceId: "i2", results: [fixed] });
		expect(() => editReviewTriage(done, { id: "t1", revision: active.revision, itemId: "f1", op: "reply", text: "Stale wording." })).toThrow("This triage changed.");
	});

	test("refuses a fixed result without changed files or evidence, and a blocked one without a reason", () => {
		expect(() => completeTriage(batch(), [{ ...fixed, changedFiles: [] }, replied])).toThrow("A fixed result needs changed files");
		expect(() => completeTriage(batch(), [{ ...fixed, evidence: " " }, replied])).toThrow("A fixed result needs changed files");
		expect(() => completeTriage(batch(), [{ id: "f1", outcome: "blocked", reason: "", reply: "Blocked.", destination: note("f1") }, replied])).toThrow("A blocked result needs a reason");
	});

	test("refuses code outcomes for a reply-only item, a missing result, and a moved destination", () => {
		expect(() => completeTriage(batch(), [fixed, { ...fixed, id: "f2", destination: note("f2") }])).toThrow("reply-only");
		expect(() => completeTriage(batch(), [fixed])).toThrow("exactly one result");
		expect(() => completeTriage(batch(), [fixed, { ...replied, destination: { kind: "thread", threadId: "T1" } }])).toThrow("bound source destination");
	});

	test("refuses results before the session read the application", () => {
		expect(() => completeTriage(running(batch(), false), [fixed, replied])).toThrow("check freshness");
	});

	test("keeps completed results: an identical retry changes nothing, a different one is refused, and a later reply edit leaves them", () => {
		const done = completeTriage(batch(), [fixed, replied]);
		expect(completeTriage(done, [fixed, replied])).toBe(done);
		expect(() => completeTriage(done, [{ ...fixed, evidence: "Other." }, replied])).toThrow("immutable");
		const reworded = editReviewTriage(done, { id: "t1", revision: done.revision, itemId: "f1", op: "reply", text: "My wording." });
		expect(reworded.batch).toEqual(done.batch);
		expect(replyOf(reworded.items[0]!, reworded)).toBe("My wording.");
	});
});

describe("parseTriageApply", () => {
	test("takes exactly an id and a revision", () => {
		expect(parseTriageApply({ id: "t1", revision: 3 })).toEqual({ ok: { id: "t1", revision: 3 } });
		expect(parseTriageApply({ id: "t1", revision: 3, selected: ["f1"] })).toBeNull();
		expect(parseTriageApply({ id: "t1", revision: -1 })).toBeNull();
	});
});

describe("latestReviewTriage", () => {
	test("keeps the finished report selected until a newer capture completes, with pending fallback", () => {
		const complete = triage([item("f1", "fix")]);
		const pending = { ...triage([]), id: "t2", capture: null };
		expect(latestReviewTriage([complete, pending])?.id).toBe("t1");
		expect(latestReviewTriage([pending])?.id).toBe("t2");
		expect(latestReviewTriage([complete, { ...pending, capture: "{}" }])?.id).toBe("t2");
	});
});
