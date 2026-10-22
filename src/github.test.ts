import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { dataOf, ghMutation, ghRestWrite, parsePerson } from "./github";
import * as proc from "./proc";

afterEach(() => {
	mock.restore();
});

test("bot identity comes from GitHub rather than a hardcoded login list", () => {
	expect(parsePerson({ __typename: "Bot", login: "cursor", avatarUrl: "https://avatars.example/cursor" })).toEqual({ login: "cursor", avatarUrl: "https://avatars.example/cursor", isBot: true });
	expect(parsePerson({ __typename: "User", login: "cursor", avatarUrl: null })).toEqual({ login: "cursor", avatarUrl: null });
});

describe("ghMutation", () => {
	const refused = {
		data: { resolveReviewThread: null },
		errors: [{ type: "NOT_FOUND", path: ["resolveReviewThread"], message: "Could not resolve to a node with the global id of 'PRRT_x'" }],
	};

	test("throws GitHub's errors beside a refused mutation's null field, which dataOf takes as data", async () => {
		spyOn(proc, "runJson").mockResolvedValue(refused);
		expect(dataOf(refused)).toEqual({ resolveReviewThread: null });
		await expect(ghMutation("mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { clientMutationId } }", { id: "PRRT_x" })).rejects.toThrow(
			"Could not resolve to a node with the global id of 'PRRT_x'",
		);
	});

	test("answers the data of a mutation GitHub took, its string variables raw and its numbers typed", async () => {
		const gh = spyOn(proc, "runJson").mockResolvedValue({ data: { addPullRequestReviewThreadReply: { clientMutationId: null } } });
		expect(await ghMutation("mutation", { thread: "PRRT_a", body: "42", count: 2 })).toEqual({ addPullRequestReviewThreadReply: { clientMutationId: null } });
		expect(gh.mock.calls[0]?.[0]).toEqual(["gh", "api", "graphql", "-f", "query=mutation", "-f", "thread=PRRT_a", "-f", "body=42", "-F", "count=2"]);
	});
});

describe("ghRestWrite", () => {
	test("sends each field as a raw string, so a body of digits, an @path, or a placeholder is sent as written", async () => {
		const gh = spyOn(proc, "runChecked").mockResolvedValue("{}");
		const body = "123\n@package.json {owner} a=b";
		await ghRestWrite("POST", "repos/acme/webapp/issues/7/comments", [["body", body]]);
		expect(gh.mock.calls[0]?.[0]).toEqual(["gh", "api", "-X", "POST", "repos/acme/webapp/issues/7/comments", "-f", `body=${body}`]);
	});
});
