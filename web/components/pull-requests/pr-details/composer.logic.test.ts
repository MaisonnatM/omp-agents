import { describe, expect, test } from "bun:test";
import { composerLabel, reviewPlaceholder, reviewVerdicts } from "./composer.logic";

describe("reviewVerdicts", () => {
	test("offers every verdict on an open or draft pull request you can comment on, only a comment on your own, and none otherwise", () => {
		expect(reviewVerdicts({ state: "open", canComment: true, byViewer: false })).toEqual(["comment", "approve", "request-changes"]);
		expect(reviewVerdicts({ state: "draft", canComment: true, byViewer: false })).toEqual(["comment", "approve", "request-changes"]);
		expect(reviewVerdicts({ state: "open", canComment: true, byViewer: true })).toEqual(["comment"]);
		expect(reviewVerdicts({ state: "open", canComment: false, byViewer: false })).toEqual([]);
		expect(reviewVerdicts({ state: "merged", canComment: true, byViewer: false })).toEqual([]);
		expect(reviewVerdicts({ state: "closed", canComment: true, byViewer: false })).toEqual([]);
	});
});

describe("composerLabel", () => {
	test("names pending line comments, then a started review, then a comment", () => {
		expect(composerLabel({ pending: 1, reviewStarted: true, canComment: true })).toBe("Review pull request, 1 comment pending");
		expect(composerLabel({ pending: 3, reviewStarted: true, canComment: true })).toBe("Review pull request, 3 comments pending");
		expect(composerLabel({ pending: 0, reviewStarted: true, canComment: true })).toBe("Review pull request");
		expect(composerLabel({ pending: 0, reviewStarted: false, canComment: false })).toBe("Review pull request");
		expect(composerLabel({ pending: 0, reviewStarted: false, canComment: true })).toBe("Comment on pull request");
	});
});

describe("reviewPlaceholder", () => {
	test("says what each verdict still needs", () => {
		expect(reviewPlaceholder("approve", 0)).toBe("Summarize your review (optional)");
		expect(reviewPlaceholder("comment", 2)).toBe("Summarize your review (optional)");
		expect(reviewPlaceholder("comment", 0)).toBe("Summarize your review or add line comments");
		expect(reviewPlaceholder("request-changes", 2)).toBe("Summarize your review (required to request changes)");
	});
});
