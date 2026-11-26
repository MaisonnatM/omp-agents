import { describe, expect, test } from "bun:test";
import { pendingOf, quickOn } from "./quick-actions";
import { messageOf } from "./starts";

const pr = { owner: "acme", repo: "app", number: 7 };
const quick = (action: "review" | "thermonuclear-review") => ({ kind: "quick", cwd: "/tmp", branch: null, prompt: "x", subject: { kind: "pull-request", pr, action }, skill: null }) as const;

describe("a pull request start", () => {
	test("Review saves a review draft; the thermonuclear review does not", () => {
		expect(messageOf(quick("review"), 1)).toMatchObject({ kind: "new", subject: { kind: "pull-request", pr }, reviewDraft: true });
		expect(messageOf(quick("thermonuclear-review"), 1)).toMatchObject({ kind: "new", subject: { kind: "pull-request", pr }, reviewDraft: false });
	});
});

describe("quickOn", () => {
	test("a failed start on a pull request belongs to that pull request only, and is no longer pending", () => {
		const failed = { op: quick("review"), phase: "failed", error: "no omp" } as const;
		expect(quickOn(failed, { kind: "pull-request", pr })).toBe(failed);
		expect(quickOn(failed, { kind: "pull-request", pr: { ...pr, number: 8 } })).toBeNull();
		expect(pendingOf(failed, { kind: "pull-request", pr })).toBeNull();
		expect(pendingOf({ ...failed, phase: "starting" }, { kind: "pull-request", pr })).toBe("review");
	});
});

