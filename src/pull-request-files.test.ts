import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as proc from "./proc";
import { listPullRequestChanges, parseBlobAnswer, parseCommitFilesAnswer, parseFilesAnswer, parsePullAnswer, parseViewedAnswer, readPullRequestFile } from "./pull-request-files";

afterEach(() => mock.restore());

describe("parseFilesAnswer", () => {
	test("lists every page's files with the explorer's statuses, a pure rename's patch empty and a too-large one's missing", () => {
		const pages = [
			[
				{ sha: "a1", filename: "src/new.ts", status: "added", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+a\n+b" },
				{ sha: "b2", filename: "src/moved.ts", previous_filename: "src/old.ts", status: "renamed", additions: 0, deletions: 0 },
			],
			[
				{ sha: "c3", filename: "dist/bundle.js", status: "modified", additions: 9000, deletions: 12 },
				{ sha: "d4", filename: "src/gone.ts", status: "removed", additions: 1, deletions: 0, patch: "@@ -1 +0,0 @@\n-x" },
				{ sha: "e5", filename: "src/copy.ts", status: "copied", additions: 0, deletions: 0 },
				{ filename: "no-sha.ts", status: "modified" },
			],
		];
		expect(parseFilesAnswer(pages)).toEqual([
			{ path: "src/new.ts", status: "added", added: 2, removed: 0, session: false, patch: "@@ -0,0 +1,2 @@\n+a\n+b", sha: "a1" },
			{ path: "src/moved.ts", status: "renamed", added: 0, removed: 0, session: false, patch: "", sha: "b2" },
			{ path: "dist/bundle.js", status: "modified", added: 9000, removed: 12, session: false, patch: null, sha: "c3" },
			{ path: "src/gone.ts", status: "deleted", added: 1, removed: 0, session: false, patch: "@@ -1 +0,0 @@\n-x", sha: "d4" },
			{ path: "src/copy.ts", status: "added", added: 0, removed: 0, session: false, patch: "", sha: "e5" },
		]);
	});

	test("an error page throws GitHub's message", () => {
		expect(() => parseFilesAnswer([{ message: "Not Found", status: "404" }])).toThrow("Not Found");
		expect(() => parseFilesAnswer({ message: "Bad credentials" })).toThrow("Bad credentials");
	});
});

describe("parseCommitFilesAnswer", () => {
	test("lists the files of every page of one commit, and throws GitHub's message for a page without files", () => {
		expect(parseCommitFilesAnswer([{ files: [{ sha: "a1", filename: "a.ts", status: "added", additions: 1, patch: "+a" }] }, { files: [{ sha: "b2", filename: "b.ts", status: "removed", deletions: 1, patch: "-b" }] }])).toEqual([
			{ path: "a.ts", status: "added", added: 1, removed: 0, session: false, patch: "+a", sha: "a1" },
			{ path: "b.ts", status: "deleted", added: 0, removed: 1, session: false, patch: "-b", sha: "b2" },
		]);
		expect(() => parseCommitFilesAnswer([{ message: "No commit found for SHA" }])).toThrow("No commit found for SHA");
	});
});

describe("parsePullAnswer", () => {
	test("reads the title and both branches, and throws GitHub's message without them", () => {
		expect(parsePullAnswer({ title: "Fix login", head: { ref: "fix-login", sha: "abc" }, base: { ref: "main" } })).toEqual({ title: "Fix login", head: "fix-login", base: "main" });
		expect(() => parsePullAnswer({ message: "Not Found" })).toThrow("Not Found");
	});
});

describe("parseBlobAnswer", () => {
	const answer = (object: unknown) => ({ data: { repository: { object } } });

	test("gives the text, or why it does not show", () => {
		expect(parseBlobAnswer(answer({ byteSize: 4, isBinary: false, isTruncated: false, text: "a\nb\n" }))).toEqual({ text: "a\nb\n" });
		expect(parseBlobAnswer(answer({ byteSize: 2 * 1024 * 1024, isBinary: false, isTruncated: true, text: null }))).toEqual({ note: "Too large to show: 2048 KB" });
		expect(parseBlobAnswer(answer({ byteSize: 300, isBinary: true, isTruncated: false, text: null }))).toEqual({ note: "Binary file" });
		expect(parseBlobAnswer(answer(null))).toEqual({ note: "GitHub has no text for this file" });
	});
});

describe("viewed files", () => {
	test("reads all GraphQL pages, including dismissed state, without dropping REST-only paths", () => {
		const page = (nodes: unknown[]) => ({ data: { repository: { pullRequest: { files: { nodes } } } } });
		expect([...parseViewedAnswer([page([{ path: "a.ts", viewerViewedState: "VIEWED" }, { path: "b.ts", viewerViewedState: "UNVIEWED" }]), page([{ path: "c.ts", viewerViewedState: "DISMISSED" }, { path: "d.ts", viewerViewedState: "OTHER" }])])]).toEqual([["a.ts", "VIEWED"], ["b.ts", "UNVIEWED"], ["c.ts", "DISMISSED"]]);
		expect(() => parseViewedAnswer([{ data: { repository: { pullRequest: null } } }])).toThrow();
	});

	test("joins paginated viewed states to REST files and orders them without reading blobs", async () => {
		const gh = spyOn(proc, "runJson").mockImplementation(async argv => {
			if (argv.includes("graphql")) return [
				{ data: { repository: { pullRequest: { files: { nodes: [{ path: "src/a.ts", viewerViewedState: "VIEWED" }] } } } } },
				{ data: { repository: { pullRequest: { files: { nodes: [{ path: "src/z.ts", viewerViewedState: "DISMISSED" }] } } } } },
			];
			if (argv.some(arg => arg.includes("/files?"))) return [[
				{ sha: "a", filename: "src/a.ts", patch: "+import './z';", additions: 1 },
				{ sha: "z", filename: "src/z.ts", additions: 0 },
				{ sha: "extra", filename: "extra.ts", additions: 0 },
			]];
			return { title: "All files", head: { ref: "feature" }, base: { ref: "main" } };
		});
		const changes = await listPullRequestChanges({ owner: "acme", repo: "files", number: 101 });
		expect(changes.files.map(file => ({ path: file.path, viewed: file.viewed }))).toEqual([
			{ path: "extra.ts", viewed: undefined }, { path: "src/z.ts", viewed: "DISMISSED" }, { path: "src/a.ts", viewed: "VIEWED" },
		]);
		const query = gh.mock.calls.find(([argv]) => argv.includes("graphql"))?.[0] ?? [];
		expect(query).toContain("--paginate");
		expect(query).toContain("--slurp");
		expect(query.find(arg => arg.startsWith("query="))).toContain("pageInfo { hasNextPage endCursor }");
		expect(query.find(arg => arg.startsWith("query="))).toContain("$endCursor");
		expect(gh.mock.calls).toHaveLength(3);
	});

	test("a file read on a cold list reads no viewed state", async () => {
		const gh = spyOn(proc, "runJson").mockImplementation(async argv => {
			if (argv.includes("graphql")) return { data: { repository: { object: { byteSize: 2, text: "a\n" } } } };
			if (argv.some(arg => arg.includes("/files?"))) return [[{ sha: "a", filename: "a.ts", status: "added", additions: 1, patch: "@@ -0,0 +1 @@\n+a" }]];
			return { title: "Cold", head: { ref: "feature" }, base: { ref: "main" } };
		});
		expect((await readPullRequestFile({ owner: "acme", repo: "files", number: 105 }, "a.ts"))?.rows).toEqual([{ sign: "+", old: null, new: 1, text: "a" }]);
		expect(gh.mock.calls.filter(([argv]) => argv.some(arg => arg.includes("viewerViewedState")))).toEqual([]);
	});
});

describe("commit-scoped changes", () => {
	const first = "a".repeat(40);
	const second = "b".repeat(40);
	const pr = { owner: "acme", repo: "commits", number: 102 };

	test("validates membership across pages and keeps each commit's files and blob independent", async () => {
		const gh = spyOn(proc, "runJson").mockImplementation(async argv => {
			if (argv.includes("graphql")) {
				if (argv.some(arg => arg.startsWith("oid="))) {
					return { data: { repository: { object: { byteSize: 10, text: argv.includes("oid=first-blob") ? "first\n" : "second\n" } } } };
				}
				return [{ data: { repository: { pullRequest: { files: { nodes: [] } } } } }];
			}
			const path = argv.at(-1) ?? "";
			if (path.includes("/pulls/102/commits")) return [[{ sha: first }], [{ sha: second }]];
			if (path.includes(`/commits/${first}?`)) return [{ files: [{ sha: "first-blob", filename: "same.ts", additions: 1, patch: "@@ -0,0 +1 @@\n+first" }] }];
			if (path.includes(`/commits/${second}?`)) return [{ files: [{ sha: "second-blob", filename: "same.ts", additions: 1, patch: "@@ -0,0 +1 @@\n+second" }] }, { files: [{ sha: "extra-blob", filename: "extra.ts", additions: 0 }] }];
			return { title: "Commit files", head: { ref: "feature" }, base: { ref: "main" } };
		});
		expect((await listPullRequestChanges(pr, first)).files.map(file => file.path)).toEqual(["same.ts"]);
		expect((await listPullRequestChanges(pr, second)).files.map(file => file.path)).toEqual(["extra.ts", "same.ts"]);
		expect((await readPullRequestFile(pr, "same.ts", first))?.rows).toEqual([{ sign: "+", old: null, new: 1, text: "first" }]);
		expect((await readPullRequestFile(pr, "same.ts", second))?.rows).toEqual([{ sign: "+", old: null, new: 1, text: "second" }]);
		expect(await readPullRequestFile(pr, "extra.ts", first)).toBeNull();
		expect(gh.mock.calls.flatMap(([argv]) => argv.filter(arg => arg.startsWith("oid=")))).toEqual(["oid=first-blob", "oid=second-blob"]);
	});

	test("rejects a commit that is not the pull request's", async () => {
		spyOn(proc, "runJson").mockResolvedValue([[{ sha: first }]]);
		await expect(listPullRequestChanges({ ...pr, number: 103 }, second)).rejects.toThrow("does not belong");
	});
});
