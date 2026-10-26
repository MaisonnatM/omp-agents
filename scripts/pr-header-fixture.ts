/**
 * A disposable repository and a fake `gh` fixture for a session header's pull request moves, with no real pull request:
 * `<dir>/repo`, a checkout of `smoke-fixture/webapp` on branch `feature`, and `<dir>/gh.json`, which has GitHub say that
 * `feature` heads no pull request (`--no-pr`) or open PR `#<number>` (`--pr`). Run it again to flip a running server's answer.
 */
import { existsSync } from "node:fs";
import { mkdir, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { run, runChecked } from "../src/proc";

const USAGE = "Usage: bun scripts/pr-header-fixture.ts <dir> (--pr <number> | --no-pr)";

const OWNER = "smoke-fixture";
const REPO = "webapp";
const BRANCH = "feature";
const BASE = "main";

const git = (cwd: string, ...args: string[]): Promise<string> =>
	runChecked(["git", "-C", cwd, "-c", "user.name=Smoke fixture", "-c", "user.email=smoke@fixture.invalid", "-c", "commit.gpgSign=false", ...args]);

/** A checkout of `main` with one commit, `origin` on GitHub with `main` as its default branch, and `feature` checked out. */
async function createRepo(repo: string): Promise<void> {
	await mkdir(repo, { recursive: true });
	await git(repo, "init", "--quiet", "-b", BASE);
	await Bun.write(join(repo, "README.md"), "# webapp\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "--quiet", "--no-verify", "-m", "Initial commit");
	await git(repo, "remote", "add", "origin", `https://github.com/${OWNER}/${REPO}.git`);
	await git(repo, "update-ref", `refs/remotes/origin/${BASE}`, "HEAD");
	await git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${BASE}`);
	await git(repo, "switch", "--quiet", "-c", BRANCH);
}

/** The pull request in the shapes GitHub's REST answer and the pull request list's GraphQL search answer give it. */
function pullRequest(number: number) {
	return {
		rest: { number, state: "open", merged_at: null, head: { ref: BRANCH }, base: { ref: BASE } },
		graphql: {
			number,
			title: "Smoke fixture change",
			isDraft: false,
			state: "OPEN",
			reviewDecision: null,
			mergeable: "MERGEABLE",
			viewerCanUpdateBranch: false,
			headRefName: BRANCH,
			baseRefName: BASE,
			updatedAt: new Date().toISOString(),
			mergedAt: null,
			additions: 1,
			deletions: 0,
			author: { login: "smoke-viewer" },
			reviewRequests: { nodes: [] },
			latestReviews: { nodes: [] },
			repository: { defaultBranchRef: { name: BASE } },
			commits: { nodes: [] },
			comments: { totalCount: 0 },
			reviewThreads: { totalCount: 0, nodes: [] },
		},
	};
}

/** The fake `gh` rules: the branch's pull request ask (`branchPullRequest`) and the pull request list's search (`loadPullRequests`). */
function rules(number: number | null) {
	const pr = number === null ? null : pullRequest(number);
	return {
		rules: [
			{
				when: ["api", `repos/${OWNER}/${REPO}/pulls?head=${encodeURIComponent(`${OWNER}:${BRANCH}`)}&`],
				stdout: pr ? [pr.rest] : [],
			},
			{
				when: ["api graphql", `authored=repo:${OWNER}/${REPO} is:pr`],
				stdout: { data: { authored: { nodes: pr ? [pr.graphql] : [] }, reviewing: { nodes: [] }, merged: { nodes: [] } } },
			},
		],
	};
}

const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({ allowPositionals: true, options: { pr: { type: "string" }, "no-pr": { type: "boolean", default: false } } });
	const number = values.pr === undefined ? null : Number(values.pr);
	if (positionals.length !== 1 || values["no-pr"] === (number !== null) || (number !== null && !(Number.isInteger(number) && number > 0))) {
		console.error(USAGE);
		process.exit(1);
	}
	await mkdir(resolve(positionals[0]!), { recursive: true });
	const dir = await realpath(resolve(positionals[0]!));
	const repo = join(dir, "repo");
	// `feature` is made last, so a run that stopped partway leaves no `feature` and the repository is made again; the
	// `.git` check keeps a checkout that `<dir>` sits in from answering for a repository not made yet.
	if (!existsSync(join(repo, ".git")) || (await run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${BRANCH}`])).code !== 0) {
		await rm(repo, { recursive: true, force: true });
		await createRepo(repo);
	}
	const fixture = join(dir, "gh.json");
	// Renamed into place, so a `gh` call while a running server flips its answer reads the old fixture or the new one, never half of one.
	await Bun.write(`${fixture}.tmp`, `${JSON.stringify(rules(number), null, "\t")}\n`);
	await rename(`${fixture}.tmp`, fixture);
	console.log(`PATH=${quote(join(import.meta.dir, "fake-gh"))}:"$PATH" FAKE_GH_FIXTURE=${quote(fixture)} FAKE_GH_LOG=${quote(join(dir, "gh.log"))}`);
	console.log(`#new/${encodeURIComponent(repo)}`);
}

await main();
