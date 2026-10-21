import { describe, expect, test } from "bun:test";
import { parsePostAnswer, parseReviewsAnswer } from "./pull-request-review";

describe("parseReviewsAnswer", () => {
	test("flattens the pages and skips a review with no author, as a deleted account leaves", () => {
		const review = { id: 5, html_url: "https://github.com/a/b/pull/1#pullrequestreview-5", user: { login: "me" }, commit_id: "c1", state: "COMMENTED", body: "Hi" };
		expect(parseReviewsAnswer([[review], [{ ...review, id: 6, user: null }, { ...review, id: 7, body: null }]])).toEqual([
			{ id: 5, url: "https://github.com/a/b/pull/1#pullrequestreview-5", login: "me", commit: "c1", state: "COMMENTED", body: "Hi" },
			{ id: 7, url: "https://github.com/a/b/pull/1#pullrequestreview-5", login: "me", commit: "c1", state: "COMMENTED", body: "" },
		]);
	});

	test("throws GitHub's message for an answer that is not a list", () => {
		expect(() => parseReviewsAnswer({ message: "Not Found" })).toThrow("Not Found");
	});
});

describe("parsePostAnswer", () => {
	test("reads the review GitHub made", () => {
		expect(parsePostAnswer({ id: 9, html_url: "https://github.com/a/b/pull/1#pullrequestreview-9" })).toEqual({ id: 9, url: "https://github.com/a/b/pull/1#pullrequestreview-9" });
	});

	test("throws GitHub's refusal with the errors it lists", () => {
		expect(() => parsePostAnswer({ message: "Unprocessable Entity", errors: ["Line could not be resolved"] })).toThrow("Unprocessable Entity: Line could not be resolved");
	});
});
