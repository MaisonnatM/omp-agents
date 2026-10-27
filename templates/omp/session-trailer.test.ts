import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trailerParameters } from "./agent/extensions/session-trailer";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("session trailer", () => {
	test("a real commit carries the trailer only when PI_SESSION_ID is set, and keeps the GIT_CONFIG_COUNT and -c entries already there", () => {
		const repo = mkdtempSync(join(tmpdir(), "omp-trailer-"));
		dirs.push(repo);
		const base = {
			...process.env,
			GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "count name",
			GIT_CONFIG_PARAMETERS: "'user.email'='param@example.com'",
			GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
		};
		const parameters = trailerParameters(base);
		expect(trailerParameters({ GIT_CONFIG_PARAMETERS: parameters })).toBeUndefined();
		const git = (args: string[], session: string) =>
			execFileSync("git", args, { cwd: repo, env: { ...base, GIT_CONFIG_PARAMETERS: parameters, PI_SESSION_ID: session }, encoding: "utf8" });
		git(["init", "-q"], "");
		git(["commit", "-q", "--allow-empty", "-m", "one"], "abc123");
		expect(git(["log", "-1", "--format=%an|%ae|%(trailers:key=Omp-Session,valueonly)"], "").trim()).toBe("count name|param@example.com|abc123");
		git(["commit", "-q", "--allow-empty", "--amend", "--no-edit"], "abc123");
		expect(git(["log", "-1", "--format=%B"], "").trim()).toBe("one\n\nOmp-Session: abc123");
		git(["commit", "-q", "--allow-empty", "-m", "two"], "");
		expect(git(["log", "-1", "--format=%B"], "").trim()).toBe("two");
	});
});
