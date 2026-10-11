import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoFiles, readRepoFile } from "./repo-files";
import { runChecked } from "./proc";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });

/**
 * A repository with `src/a.ts`, `.gitignore` (ignoring `*.log`), a binary `logo.bin`, and `link.txt`, a link to a file
 * outside it, committed; then `notes.md` left untracked and `debug.log` ignored. `outside` is the linked file.
 */
async function repo(): Promise<{ root: string; outside: string }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-repo-")));
	dirs.push(parent);
	const root = join(parent, "app");
	mkdirSync(join(root, "src"), { recursive: true });
	const outside = join(parent, "secret.txt");
	writeFileSync(outside, "secret\n");
	await git(root, "init", "-q", "-b", "main");
	writeFileSync(join(root, "src", "a.ts"), "one\ntwo\n");
	writeFileSync(join(root, ".gitignore"), "*.log\n");
	writeFileSync(join(root, "logo.bin"), new Uint8Array([137, 80, 0, 1]));
	symlinkSync(outside, join(root, "link.txt"));
	await git(root, "add", ".");
	await git(root, "commit", "-q", "-m", "base");
	writeFileSync(join(root, "notes.md"), "# Notes\n");
	writeFileSync(join(root, "debug.log"), "noise\n");
	return { root, outside };
}

describe("listRepoFiles", () => {
	test("lists tracked and untracked files by path, leaving out ignored ones, from any directory of the checkout", async () => {
		const { root } = await repo();
		const listed = await listRepoFiles(join(root, "src"));
		expect(listed).toEqual({ root, rootDisplay: root, branch: "main", files: [".gitignore", "link.txt", "logo.bin", "notes.md", "src/a.ts"] });
	});

	test("answers null outside git", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-repo-")));
		dirs.push(dir);
		expect(await listRepoFiles(dir)).toBe(null);
	});
});

describe("readRepoFile", () => {
	test("numbers every line of a listed file, unchanged", async () => {
		const { root } = await repo();
		expect(await readRepoFile(root, "src/a.ts")).toEqual({
			path: "src/a.ts",
			rows: [
				{ sign: " ", old: 1, new: 1, text: "one" },
				{ sign: " ", old: 2, new: 2, text: "two" },
			],
			note: null,
		});
	});

	test("reads only a path the list holds", async () => {
		const { root } = await repo();
		expect(await readRepoFile(root, "debug.log")).toBe(null);
		expect(await readRepoFile(root, "missing.ts")).toBe(null);
		expect(await readRepoFile(root, "../secret.txt")).toBe(null);
		expect(await readRepoFile(root, "src/../../secret.txt")).toBe(null);
	});

	test("shows a note for a binary file, a link out of the checkout, and a tracked file deleted from disk", async () => {
		const { root } = await repo();
		expect(await readRepoFile(root, "logo.bin")).toEqual({ path: "logo.bin", rows: null, note: "Binary file" });
		expect(await readRepoFile(root, "link.txt")).toEqual({ path: "link.txt", rows: null, note: "Links to a file outside the checkout" });
		rmSync(join(root, "src", "a.ts"));
		expect(await readRepoFile(root, "src/a.ts")).toEqual({ path: "src/a.ts", rows: null, note: "Deleted" });
	});
});
