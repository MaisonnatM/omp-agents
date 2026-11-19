import { describe, expect, test } from "bun:test";
import { linearIssueId, linearIssueIdsIn } from "./linear";

describe("linearIssueId", () => {
	test("reads an id in any case, or an issue's link, as the upper-cased id", () => {
		expect(linearIssueId(" eng-3025 ")).toBe("ENG-3025");
		expect(linearIssueId("https://linear.app/yampa/issue/ENG-3025/move-our-verification-loop")).toBe("ENG-3025");
	});

	test("names no issue for other text or another site's link", () => {
		expect(linearIssueId("ENG 3025")).toBeNull();
		expect(linearIssueId("fix ENG-3025 today")).toBeNull();
		expect(linearIssueId("https://github.com/yampa-ai/yampa/issue/ENG-3025")).toBeNull();
	});
});

describe("linearIssueIdsIn", () => {
	test("lists each linked issue once, in the order the texts first link it", () => {
		const texts = [
			"Shipping [ENG-12](https://linear.app/yampa/issue/ENG-12/title) and https://linear.app/yampa/issue/eng-7",
			"Back to https://linear.app/yampa/issue/ENG-12 after ENG-99, which has no link",
		];
		expect(linearIssueIdsIn(texts)).toEqual(["ENG-12", "ENG-7"]);
	});
});
