import { describe, expect, test } from "bun:test";
import { parseBlobAnswer, parseFilesAnswer, parsePullAnswer } from "./pull-request-files";

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
