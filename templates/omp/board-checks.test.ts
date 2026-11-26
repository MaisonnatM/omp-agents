import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doneRefusal } from "./agent/extensions/board/checks";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const CHECK_TEST_EDITS = `bun ${JSON.stringify(join(import.meta.dir, "../../scripts/check-test-edits.ts"))}`;

/** A repository on `feature`, branched from `main` with `land.json` (none when `null`) and a test, and `commits` on `feature`: file contents and a message each. */
function repo(config: object | null, commits: { files: Record<string, string>; message: string }[]) {
	const dir = mkdtempSync(join(tmpdir(), "board-checks-"));
	dirs.push(dir);
	execFileSync("git", ["init", "-q", "-b", "main", dir]);
	git(dir, "config", "user.name", "t");
	git(dir, "config", "user.email", "t@t");
	writeFileSync(join(dir, "a.test.ts"), "old\n");
	if (config) {
		mkdirSync(join(dir, ".omp"));
		writeFileSync(join(dir, ".omp/land.json"), JSON.stringify(config));
	}
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	git(dir, "switch", "-q", "-c", "feature");
	for (const { files, message } of commits) {
		for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", message);
	}
	return dir;
}

describe("done's checks", () => {
	test("refuses a branch that edits a test without a test-change line, with the script's error", async () => {
		const dir = repo({ checks: [CHECK_TEST_EDITS, ["false"]] }, [{ files: { "a.test.ts": "new\n" }, message: "tweak a test" }]);
		const refused = await doneRefusal(dir);
		expect(refused).toContain(`Not done: \`${CHECK_TEST_EDITS}\` from .omp/land.json failed`);
		expect(refused).toContain("ERROR: a.test.ts existed at");
	});

	test("passes once a commit says why, and never runs the suite group", async () => {
		const dir = repo({ checks: [CHECK_TEST_EDITS, ["false"]] }, [{ files: { "a.test.ts": "new\n" }, message: "tweak a test\n\ntest-change: the behavior changed" }]);
		expect(await doneRefusal(dir)).toBeNull();
	});

	test("runs each leading check with LAND_BASE at the merge base and LAND_TIP at the committed HEAD", async () => {
		const dir = repo({ checks: ["test \"$LAND_BASE\" = \"$(git rev-parse main)\" && test \"$LAND_TIP\" = \"$(git rev-parse HEAD)\" || { echo wrong-env; exit 1; }", "git diff --quiet \"$LAND_BASE\" HEAD -- CHANGELOG.md && { echo needs-changelog; exit 1; } || true", ["false"]] }, [{ files: { "b.txt": "b\n" }, message: "work" }]);
		const refused = await doneRefusal(dir);
		expect(refused).toContain("needs-changelog");
		expect(refused).not.toContain("wrong-env");
	});

	test("runs nothing on a branch with no commit main lacks, in a repository without land.json, or with no group after the checks", async () => {
		const failing = { checks: ["exit 1", ["true"]] };
		expect(await doneRefusal(repo(failing, []))).toBeNull();
		expect(await doneRefusal(repo(null, [{ files: { "b.txt": "b\n" }, message: "work" }]))).toBeNull();
		expect(await doneRefusal(repo({ checks: ["exit 1"] }, [{ files: { "b.txt": "b\n" }, message: "work" }]))).toBeNull();
	});
});
