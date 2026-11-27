import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { cloneUrl, dataOf, ghGraphql, ghMutation, ghRest, ghRestWrite, parsePerson } from "./github";
import * as proc from "./proc";

afterEach(() => {
	mock.restore();
});

test("bot identity comes from GitHub rather than a hardcoded login list", () => {
	expect(parsePerson({ __typename: "Bot", login: "cursor", avatarUrl: "https://avatars.example/cursor" })).toEqual({ login: "cursor", avatarUrl: "https://avatars.example/cursor", isBot: true });
	expect(parsePerson({ __typename: "User", login: "cursor", avatarUrl: null })).toEqual({ login: "cursor", avatarUrl: null });
});

test("a team is named by its slug and marked a team", () => {
	expect(parsePerson({ slug: "frontend", avatarUrl: null })).toEqual({ login: "frontend", avatarUrl: null, isTeam: true });
});

test("a repository clones over SSH when gh's git_protocol says ssh, and over HTTPS otherwise, gh's default", () => {
	expect(cloneUrl("ann/omp-settings", "ssh\n")).toBe("git@github.com:ann/omp-settings.git");
	expect(cloneUrl("ann/omp-settings", "https\n")).toBe("https://github.com/ann/omp-settings.git");
	expect(cloneUrl("ann/omp-settings", "")).toBe("https://github.com/ann/omp-settings.git");
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

test("real GitHub read callers share quota cooldown while REST remains available", async () => {
	const gh = spyOn(proc, "runJson").mockImplementation(async argv => {
		if (argv.includes("rate_limit")) return { resources: { graphql: { remaining: 0, reset: Math.floor(Date.now() / 1000) + 3600 } } };
		if (argv.includes("graphql")) throw new Error("API rate limit exceeded");
		return { title: "Read through REST" };
	});
	try {
		await expect(ghGraphql("query { viewer { login } }", {})).rejects.toThrow("GraphQL quota exhausted");
		await expect(ghGraphql("query { viewer { name } }", {})).rejects.toThrow("GraphQL quota exhausted");
		expect(await ghRest("repos/acme/app/pulls/7")).toEqual({ title: "Read through REST" });
		expect(gh.mock.calls.filter(([argv]) => argv.includes("graphql"))).toHaveLength(1);
		expect(gh.mock.calls.filter(([argv]) => argv.includes("rate_limit"))).toHaveLength(1);
	} finally {
		// The cooldown is shared state on disk, under the test run's XDG_CONFIG_HOME; later tests read GraphQL again.
		rmSync(join(process.env.XDG_CONFIG_HOME!, "omp-agents", "github"), { recursive: true, force: true });
	}
});
