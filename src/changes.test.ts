import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listChanges, readChangedFile, type SessionPlace } from "./changes";
import { runChecked } from "./proc";
import { type DiffRow, parseFullDiff, patchRows } from "./shared/changes";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });
const edit = (path: string) => ({ type: "message", message: { role: "toolResult", toolCallId: `c-${path}`, toolName: "edit", details: { path, diff: "+1|x" }, isError: false } });

/**
 * A repository with `kept.ts` and `gone.ts` committed, then `kept.ts` edited by the session, `gone.ts` deleted, `new.ts`
 * left untracked, and a file outside the repository edited by the session.
 */
async function place(): Promise<{ place: SessionPlace; root: string; outside: string }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-changes-")));
	dirs.push(parent);
	const root = join(parent, "app");
	mkdirSync(root);
	await git(root, "init", "-q", "-b", "main");
	writeFileSync(join(root, "kept.ts"), "one\ntwo\nthree\n");
	writeFileSync(join(root, "gone.ts"), "bye\n");
	await git(root, "add", ".");
	await git(root, "commit", "-q", "-m", "base");
	writeFileSync(join(root, "kept.ts"), "one\n2\nthree\nfour\n");
	rmSync(join(root, "gone.ts"));
	writeFileSync(join(root, "new.ts"), "a\nb");
	const outside = join(parent, "notes.md");
	writeFileSync(outside, "note\n");
	const file = join(parent, "session.jsonl");
	writeFileSync(file, [{ type: "session", cwd: root }, edit(join(root, "kept.ts")), edit("notes.md"), edit(outside)].map(entry => JSON.stringify(entry)).join("\n"));
	return { place: { file, dir: root }, root, outside };
}

describe("listChanges", () => {
	test("merges git's changes against HEAD with the session's own files, outside the checkout included", async () => {
		const { place: at, root, outside } = await place();
		const changes = await listChanges(at);
		expect(changes.root).toBe(root);
		expect(changes.branch).toBe("main");
		expect(changes.base?.ref).toBe("HEAD");
		expect(changes.files).toEqual([
			{ path: "gone.ts", status: "deleted", added: 0, removed: 1, session: false },
			{ path: "kept.ts", status: "modified", added: 2, removed: 1, session: true },
			{ path: "new.ts", status: "untracked", added: 2, removed: 0, session: false },
			// A relative path resolves against the session's cwd: an edit git sees no change in still lists.
			{ path: "notes.md", status: null, added: null, removed: null, session: true },
			{ path: outside, status: null, added: null, removed: null, session: true },
		]);
	});

	test("a repository with no commit yet lists its files against the empty tree", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-changes-")));
		dirs.push(root);
		await git(root, "init", "-q", "-b", "main");
		writeFileSync(join(root, "staged.ts"), "s\n");
		writeFileSync(join(root, "loose.ts"), "l\n");
		await git(root, "add", "staged.ts");
		const at = { file: join(root, "none.jsonl"), dir: root };
		expect((await listChanges(at)).files.map(file => [file.path, file.status])).toEqual([
			["loose.ts", "untracked"],
			["staged.ts", "added"],
		]);
		expect((await readChangedFile(at, "staged.ts"))?.rows).toEqual([{ sign: "+", old: null, new: 1, text: "s" }]);
	});
});

describe("readChangedFile", () => {
	test("reads only a path the list holds", async () => {
		const { place: at } = await place();
		expect(await readChangedFile(at, "../session.jsonl")).toBe(null);
		expect(await readChangedFile(at, "/etc/passwd")).toBe(null);
	});

	test("numbers every line of a tracked, untracked, and deleted file's diff", async () => {
		const { place: at } = await place();
		expect((await readChangedFile(at, "kept.ts"))?.rows).toEqual([
			{ sign: " ", old: 1, new: 1, text: "one" },
			{ sign: "-", old: 2, new: null, text: "two" },
			{ sign: "+", old: null, new: 2, text: "2" },
			{ sign: " ", old: 3, new: 3, text: "three" },
			{ sign: "+", old: null, new: 4, text: "four" },
		]);
		expect((await readChangedFile(at, "new.ts"))?.rows).toEqual([
			{ sign: "+", old: null, new: 1, text: "a" },
			{ sign: "+", old: null, new: 2, text: "b" },
		]);
		expect((await readChangedFile(at, "gone.ts"))?.rows).toEqual([{ sign: "-", old: 1, new: null, text: "bye" }]);
	});

	test("a path with glob characters names that one file", async () => {
		const { place: at, root } = await place();
		mkdirSync(join(root, "[id]"));
		mkdirSync(join(root, "i"));
		writeFileSync(join(root, "[id]", "page.ts"), "p\n");
		writeFileSync(join(root, "i", "page.ts"), "q\n");
		await git(root, "add", ".");
		await git(root, "commit", "-q", "-m", "pages");
		writeFileSync(join(root, "[id]", "page.ts"), "P\n");
		writeFileSync(join(root, "i", "page.ts"), "Q\n");
		expect((await readChangedFile(at, "[id]/page.ts"))?.rows).toEqual([
			{ sign: "-", old: 1, new: null, text: "p" },
			{ sign: "+", old: null, new: 1, text: "P" },
		]);
	});

	test("shows a file git does not compare whole, as unchanged lines", async () => {
		const { place: at, outside } = await place();
		expect(await readChangedFile(at, outside)).toEqual({ path: outside, rows: [{ sign: " ", old: 1, new: 1, text: "note" }], note: null });
	});
});

describe("parseFullDiff", () => {
	test("skips the header and the no-newline marker, and numbers from the hunk's start", () => {
		const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -4,2 +4,2 @@", " same", "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file", ""].join("\n");
		expect(parseFullDiff(diff)).toEqual([
			{ sign: " ", old: 4, new: 4, text: "same" },
			{ sign: "-", old: 5, new: null, text: "old" },
			{ sign: "+", old: null, new: 5, text: "new" },
		]);
	});

	test("a header line that looks like a change is not a row, and no hunk means no rows", () => {
		expect(parseFullDiff("--- a/x\n+++ b/x\n")).toEqual([]);
		expect(parseFullDiff("")).toEqual([]);
	});
});

describe("patchRows", () => {
	const context = (old: number, line: number, text: string): DiffRow => ({ sign: " ", old, new: line, text });

	test("fills the lines before, between, and after the hunks from the head, numbering the old side past each change", () => {
		const head = ["1", "2", "3", "4", "FIVE", "6", "7", "8", "10", "11", "12", ""].join("\n");
		const patch = ["@@ -4,3 +4,3 @@", " 4", "-5", "+FIVE", " 6", "@@ -8,3 +8,2 @@", " 8", "-9", " 10"].join("\n");
		expect(patchRows(patch, head)).toEqual([
			context(1, 1, "1"),
			context(2, 2, "2"),
			context(3, 3, "3"),
			context(4, 4, "4"),
			{ sign: "-", old: 5, new: null, text: "5" },
			{ sign: "+", old: null, new: 5, text: "FIVE" },
			context(6, 6, "6"),
			context(7, 7, "7"),
			context(8, 8, "8"),
			{ sign: "-", old: 9, new: null, text: "9" },
			context(10, 9, "10"),
			context(11, 10, "11"),
			context(12, 11, "12"),
		]);
	});

	test("an added file's patch holds every line, as does a removed one's with no head", () => {
		expect(patchRows("@@ -0,0 +1,2 @@\n+a\n+b", "a\nb\n")).toEqual([
			{ sign: "+", old: null, new: 1, text: "a" },
			{ sign: "+", old: null, new: 2, text: "b" },
		]);
		expect(patchRows("@@ -1,2 +0,0 @@\n-a\n-b", "")).toEqual([
			{ sign: "-", old: 1, new: null, text: "a" },
			{ sign: "-", old: 2, new: null, text: "b" },
		]);
	});

	test("a file renamed without a change is its head text, every line unchanged", () => {
		expect(patchRows("", "x\ny\n")).toEqual([context(1, 1, "x"), context(2, 2, "y")]);
	});
});
