import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { editedTests } from "./check-test-edits";

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
	const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
	if (done.exitCode !== 0) throw new Error(done.stderr.toString());
	return done.stdout.toString().trim();
}

function write(repo: string, path: string, text: string): void {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), text);
}

/** A repository whose first commit, returned as `base`, holds a test in each shape the check recognizes. */
function repoWithTests(): { repo: string; base: string } {
	const repo = mkdtempSync(join(tmpdir(), "check-test-edits-"));
	repos.push(repo);
	git(repo, "init", "--quiet");
	for (const path of ["src/a.test.ts", "web/b.test.tsx", "lib/__tests__/c.ts", "tests/d.ts", "src/code.ts"]) write(repo, path, "one\n");
	git(repo, "add", ".");
	git(repo, "commit", "--quiet", "-m", "base");
	return { repo, base: git(repo, "rev-parse", "HEAD") };
}

function commit(repo: string, message: string): void {
	git(repo, "add", "-A");
	git(repo, "commit", "--quiet", "-m", message);
}

afterEach(() => {
	for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe("editedTests", () => {
	test("reports every existing test that was modified or deleted", () => {
		const { repo, base } = repoWithTests();
		write(repo, "src/a.test.ts", "two\n");
		write(repo, "lib/__tests__/c.ts", "two\n");
		unlinkSync(join(repo, "web/b.test.tsx"));
		unlinkSync(join(repo, "tests/d.ts"));
		commit(repo, "change tests");
		expect(editedTests(repo, base)).toEqual([
			{ path: "lib/__tests__/c.ts", change: "modified" },
			{ path: "src/a.test.ts", change: "modified" },
			{ path: "tests/d.ts", change: "deleted" },
			{ path: "web/b.test.tsx", change: "deleted" },
		]);
	});

	test("allows new tests and changes to code that is not a test", () => {
		const { repo, base } = repoWithTests();
		write(repo, "src/new.test.ts", "one\n");
		write(repo, "src/code.ts", "two\n");
		commit(repo, "add a test");
		expect(editedTests(repo, base)).toEqual([]);
	});

	test("reports a moved test as the deletion of its old path", () => {
		const { repo, base } = repoWithTests();
		git(repo, "mv", "src/a.test.ts", "src/moved.test.ts");
		commit(repo, "move a test");
		expect(editedTests(repo, base)).toEqual([{ path: "src/a.test.ts", change: "deleted" }]);
	});

	test("allows the edits once any commit in the range has a test-change line", () => {
		const { repo, base } = repoWithTests();
		write(repo, "src/a.test.ts", "two\n");
		commit(repo, "change a test\n\ntest-change: the greeting now says two");
		write(repo, "src/code.ts", "two\n");
		commit(repo, "later work");
		expect(editedTests(repo, base)).toEqual([]);
	});

	test("ignores a test-change line with no reason", () => {
		const { repo, base } = repoWithTests();
		write(repo, "src/a.test.ts", "two\n");
		commit(repo, "change a test\n\ntest-change:");
		expect(editedTests(repo, base)).toEqual([{ path: "src/a.test.ts", change: "modified" }]);
	});
});
