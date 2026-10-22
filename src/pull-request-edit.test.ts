import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import * as proc from "./proc";
import { attachToPullRequest, markPullRequestFileViewed, savePullRequest, stateSteps } from "./pull-request-edit";

afterEach(() => mock.restore());

test("a title edit patches GitHub and returns the refreshed title", async () => {
	const write = spyOn(proc, "runChecked").mockResolvedValue("");
	spyOn(proc, "runJson").mockImplementation(async argv => argv.includes("graphql") ? {
		data: { repository: { pullRequest: { number: 7, title: "A better title", state: "OPEN", headRefName: "feature", headRefOid: "abc", baseRefName: "main", createdAt: "2026-10-01T00:00:00Z" } } },
	} : { behind_by: 2 });
	const detail = await savePullRequest({ owner: "acme", repo: "app", number: 7, change: { field: "title", title: "A better title" } });
	expect(write.mock.calls[0]?.[0]).toEqual(["gh", "api", "-X", "PATCH", "repos/acme/app/pulls/7", "-f", "title=A better title"]);
	expect({ title: detail.title, behindBy: detail.behindBy }).toEqual({ title: "A better title", behindBy: 2 });
});

test("a branch update rebases the head read from GitHub, not a stale page", async () => {
	const calls = spyOn(proc, "runJson").mockImplementation(async argv => {
		if (argv.some(arg => arg.includes("updatePullRequestBranch"))) return { data: { updatePullRequestBranch: { clientMutationId: null } } };
		if (!argv.includes("graphql")) return { behind_by: 0 };
		return { data: { repository: { pullRequest: { id: "PR_7", number: 7, title: "Feature", state: "OPEN", headRefName: "feature", headRefOid: "latest-head", baseRefName: "main", createdAt: "2026-10-01T00:00:00Z" } } } };
	});
	const detail = await savePullRequest({ owner: "acme", repo: "app", number: 7, change: { field: "update", method: "rebase" } });
	const mutation = calls.mock.calls.find(([argv]) => argv.some(arg => arg.includes("updatePullRequestBranch")))?.[0];
	expect(mutation?.slice(-6)).toEqual(["-f", "id=PR_7", "-f", "head=latest-head", "-f", "method=REBASE"]);
	expect({ title: detail.title, behindBy: detail.behindBy }).toEqual({ title: "Feature", behindBy: 0 });
});

describe("viewed files", () => {
	test("marks and unmarks a path on the pull request node id through GraphQL, reading nothing back", async () => {
		const gh = spyOn(proc, "runJson").mockImplementation(async argv => argv.some(arg => /(?:markFileAsViewed|unmarkFileAsViewed)\(/.test(arg))
			? { data: { changed: { clientMutationId: null } } }
			: { data: { repository: { pullRequest: { id: "PR_7" } } } });
		for (const on of [true, false]) {
			expect(await markPullRequestFileViewed({ owner: "acme", repo: "app", number: 7, path: "src/a file.ts", on })).toBeUndefined();
		}
		const mutations = gh.mock.calls.map(([argv]) => argv).filter(argv => argv.some(arg => /(?:markFileAsViewed|unmarkFileAsViewed)\(/.test(arg)));
		expect(mutations).toHaveLength(2);
		expect(mutations[0]?.find(arg => arg.startsWith("query="))).toContain("markFileAsViewed(input: { pullRequestId: $id, path: $path })");
		expect(mutations[1]?.find(arg => arg.startsWith("query="))).toContain("unmarkFileAsViewed(input: { pullRequestId: $id, path: $path })");
		expect(mutations.map(argv => argv.slice(-4))).toEqual([["-f", "id=PR_7", "-f", "path=src/a file.ts"], ["-f", "id=PR_7", "-f", "path=src/a file.ts"]]);
		expect(gh.mock.calls).toHaveLength(4);
	});

	test("throws a refused viewed mutation", async () => {
		const gh = spyOn(proc, "runJson").mockImplementation(async argv => argv.some(arg => arg.includes("markFileAsViewed("))
			? { data: { markFileAsViewed: null }, errors: [{ message: "Path does not exist in this pull request" }] }
			: { data: { repository: { pullRequest: { id: "PR_7" } } } });
		await expect(markPullRequestFileViewed({ owner: "acme", repo: "app", number: 7, path: "missing.ts", on: true })).rejects.toThrow("Path does not exist");
		expect(gh.mock.calls).toHaveLength(2);
	});
});

describe("stateSteps", () => {
	const open = { open: true, draft: false };
	const draft = { open: true, draft: true };
	const closed = { open: false, draft: false };
	const closedDraft = { open: false, draft: true };

	test("takes no step to the state the pull request is in", () => {
		expect(stateSteps(open, "open")).toEqual([]);
		expect(stateSteps(draft, "draft")).toEqual([]);
		expect(stateSteps(closed, "closed")).toEqual([]);
		expect(stateSteps(closedDraft, "closed")).toEqual([]);
	});

	test("flips the draft flag of an open pull request, and closes either kind", () => {
		expect(stateSteps(open, "draft")).toEqual(["convertPullRequestToDraft"]);
		expect(stateSteps(draft, "open")).toEqual(["markPullRequestReadyForReview"]);
		expect(stateSteps(draft, "closed")).toEqual(["closePullRequest"]);
	});

	test("reopens a closed pull request before it changes the draft flag", () => {
		expect(stateSteps(closed, "open")).toEqual(["reopenPullRequest"]);
		expect(stateSteps(closed, "draft")).toEqual(["reopenPullRequest", "convertPullRequestToDraft"]);
		expect(stateSteps(closedDraft, "open")).toEqual(["reopenPullRequest", "markPullRequestReadyForReview"]);
		expect(stateSteps(closedDraft, "draft")).toEqual(["reopenPullRequest"]);
	});
});

describe("attachToPullRequest", () => {
	const attachment = {
		owner: "acme",
		repo: "app",
		number: 7,
		files: [
			{ name: "page.png", type: "image/png" as const, data: Buffer.from("png").toString("base64"), alt: "The sidebar #2" },
			{ name: "shot 1", type: "image/jpeg" as const, data: Buffer.from("jpg").toString("base64"), alt: "" },
			{ name: "../diagram.png", type: "image/svg+xml" as const, data: Buffer.from("<svg/>").toString("base64"), alt: "Flow" },
		],
	};

	test("runs gh pr edit with each image as a temporary file named for its type, its alt text after the #, then removes the files", async () => {
		let written: string[] = [];
		const gh = spyOn(proc, "runChecked").mockImplementation(async argv => {
			written = argv.filter((_, index) => argv[index - 1] === "--attach").map(arg => readFileSync(arg.slice(0, arg.indexOf("#")), "utf8"));
			return "";
		});

		await attachToPullRequest(attachment);

		const argv = gh.mock.calls[0]![0];
		const dir = dirname(argv[7]!);
		expect(argv).toEqual(["gh", "pr", "edit", "7", "-R", "acme/app", "--attach", `${dir}/1-page.png#The sidebar #2`, "--attach", `${dir}/2-shot_1.jpg#`, "--attach", `${dir}/3-.._diagram.png.svg#Flow`]);
		expect(written).toEqual(["png", "jpg", "<svg/>"]);
		expect(existsSync(dir)).toBe(false);
	});

	test("removes the temporary files when gh fails, and throws its error", async () => {
		const gh = spyOn(proc, "runChecked").mockRejectedValue(new Error("HTTP 422: upload failed"));

		await expect(attachToPullRequest(attachment)).rejects.toThrow("HTTP 422: upload failed");

		expect(existsSync(dirname(gh.mock.calls[0]![0][7]!))).toBe(false);
	});
});
