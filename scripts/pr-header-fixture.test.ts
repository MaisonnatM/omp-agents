import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBranchOf, worktreeAt } from "../src/git";
import { run, runChecked } from "../src/proc";
import { branchPullRequest, loadPullRequests, repoOf } from "../src/pull-requests";

const dir = mkdtempSync(join(tmpdir(), "omp-pr-header-fixture-"));
const fixture = (...args: string[]): Promise<string> => runChecked(["bun", join(import.meta.dir, "pr-header-fixture.ts"), dir, ...args]);
const saved = { PATH: process.env.PATH, FAKE_GH_FIXTURE: process.env.FAKE_GH_FIXTURE, FAKE_GH_LOG: process.env.FAKE_GH_LOG };
let repo = "";

beforeAll(async () => {
	const printed = (await fixture("--no-pr")).trim().split("\n");
	repo = decodeURIComponent(printed[1]!.slice("#new/".length));
	process.env.PATH = `${join(import.meta.dir, "fake-gh")}:${saved.PATH}`;
	process.env.FAKE_GH_FIXTURE = join(dir, "gh.json");
	process.env.FAKE_GH_LOG = join(dir, "gh.log");
});

afterAll(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(dir, { recursive: true, force: true });
});

test("the fixture repository is smoke-fixture/webapp on branch feature, whose default branch is main", async () => {
	expect(await repoOf(repo)).toEqual({ owner: "smoke-fixture", repo: "webapp" });
	expect((await worktreeAt(repo))?.branch).toBe("feature");
	expect(await defaultBranchOf(repo)).toBe("main");
});

test("the real GitHub readers see no pull request for feature, then PR 7 once the fixture says so", async () => {
	const webapp = { owner: "smoke-fixture", repo: "webapp" };
	expect(await branchPullRequest(webapp, "feature")).toBeNull();
	expect(await loadPullRequests([repo], true)).toEqual({ repos: [{ ...webapp, cwds: [repo], pullRequests: [] }], unmatched: [] });

	await fixture("--pr", "7");
	expect(await branchPullRequest(webapp, "feature")).toEqual({ ...webapp, number: 7 });
	expect(await loadPullRequests([repo], true)).toMatchObject({
		repos: [{ ...webapp, cwds: [repo], pullRequests: [{ number: 7, head: "feature", base: "main", stackedOn: null, state: "open", role: "author", author: { login: "smoke-viewer" } }] }],
		unmatched: [],
	});
});

test("a gh call no rule answers exits 1 with one line saying so, and the log records it", async () => {
	expect(await run(["gh", "api", "user"])).toEqual({ stdout: "", stderr: "fake gh: no fixture rule answers gh api user\n", code: 1 });
	const last = readFileSync(join(dir, "gh.log"), "utf8").trim().split("\n").map(line => JSON.parse(line)).at(-1);
	expect({ argv: last.argv, rule: last.rule }).toEqual({ argv: ["api", "user"], rule: null });
});
