import { afterEach, describe, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghGraphql, githubQuota, ghPolledGraphql } from "./github";
import { GithubQuota, GithubQuotaPaused, GRAPHQL_RESERVE, type GraphqlQuota, parseRateLimit, pausedText } from "./github-quota";
import * as proc from "./proc";
import { runChecked } from "./proc";
import { loadPullRequests } from "./pull-requests";
import { GitHubQuotaError } from "../templates/omp/agent/extensions/github/access";

afterEach(() => {
	mock.restore();
	setSystemTime();
});

const MINUTE = 60_000;
const NOW = Date.parse("2026-01-01T09:00:00Z");

/** `gh api rate_limit`'s answer with `remaining` GraphQL points left until `reset`. */
const rateLimit = (remaining: number, reset: number) => ({
	resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: reset / 1000 }, graphql: { limit: 5000, used: 5000 - remaining, remaining, reset: reset / 1000 } },
});

test("the GraphQL quota comes from gh api rate_limit, its reset in milliseconds", () => {
	expect(parseRateLimit(rateLimit(42, 1_700_000_000_000))).toEqual({ remaining: 42, reset: 1_700_000_000_000 });
	expect(parseRateLimit({ message: "Bad credentials" })).toBeNull();
});

describe("GithubQuota", () => {
	/** A gate whose quota reads answer `quota()`, counting them. */
	function gate(quota: () => GraphqlQuota | null | Promise<GraphqlQuota | null>) {
		const reads = { count: 0 };
		return {
			reads,
			quota: new GithubQuota(async () => {
				reads.count++;
				return quota();
			}),
		};
	}

	test("at the reserve it admits reads, asking the quota again after 30 seconds", async () => {
		setSystemTime(NOW);
		const { quota, reads } = gate(() => ({ remaining: GRAPHQL_RESERVE, reset: NOW + 20 * MINUTE }));
		await quota.admit();
		await quota.admit();
		expect(reads.count).toBe(1);
		setSystemTime(NOW + 31_000);
		await quota.admit();
		expect(reads.count).toBe(2);
	});

	test("below the reserve it pauses until the reset without asking again, then admits", async () => {
		setSystemTime(NOW);
		const reset = NOW + 20 * MINUTE;
		let left = GRAPHQL_RESERVE - 1;
		const { quota, reads } = gate(() => ({ remaining: left, reset }));
		await expect(quota.admit()).rejects.toThrow(new GithubQuotaPaused(pausedText(reset)));
		setSystemTime(reset - MINUTE);
		await expect(quota.admit()).rejects.toBeInstanceOf(GithubQuotaPaused);
		expect(reads.count).toBe(1);
		setSystemTime(reset + MINUTE);
		left = 5000;
		await quota.admit();
		expect(reads.count).toBe(2);
	});

	test("a quota it cannot read admits reads, and is kept 30 seconds like one it read", async () => {
		setSystemTime(NOW);
		const { quota, reads } = gate(() => Promise.reject(new Error("gh: not logged in")));
		await quota.admit();
		await quota.admit();
		expect(reads.count).toBe(1);
	});
});

/** The wiring to the server's one `githubQuota`, whose answers each test sets, so no test depends on what another left in it. */
describe("ghGraphql and ghPolledGraphql", () => {
	const pause = new GithubQuotaPaused(pausedText(NOW));

	/** Answers every `gh` call with `answer()`, listing the calls. */
	function github(answer: () => unknown = () => ({ data: {} })): string[][] {
		const calls: string[][] = [];
		spyOn(proc, "runJson").mockImplementation(async argv => {
			calls.push(argv);
			return answer();
		});
		return calls;
	}

	test("while the quota is held for agents, a polled read asks GitHub nothing, while a user's call still runs", async () => {
		spyOn(githubQuota, "admit").mockRejectedValue(pause);
		const calls = github();
		await expect(ghPolledGraphql("query", {})).rejects.toBe(pause);
		expect(calls).toEqual([]);
		expect(await ghGraphql("mutation", {})).toEqual({ data: {} });
		expect(calls).toHaveLength(1);
	});

	test("an admitted polled read asks GitHub", async () => {
		spyOn(githubQuota, "admit").mockResolvedValue();
		const calls = github();
		expect(await ghPolledGraphql("query", {})).toEqual({ data: {} });
		expect(calls).toHaveLength(1);
	});

	/** A workspace whose `origin` is a GitHub repository, removed after `run`. */
	async function inWorkspace(run: (dir: string) => Promise<void>): Promise<void> {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-github-quota-"));
		try {
			await runChecked(["git", "init", "-q", dir]);
			await runChecked(["git", "-C", dir, "remote", "add", "origin", "git@github.com:acme/quota.git"]);
			await run(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	test("below the reserve, the pull request list fails whole, so the page keeps the list it has", async () => {
		spyOn(githubQuota, "admit").mockRejectedValue(pause);
		await inWorkspace(async dir => {
			const calls = github();
			await expect(loadPullRequests([dir], true)).rejects.toBe(pause);
			expect(calls).toEqual([]);
		});
	});

	test("a budget GitHub reports spent fails the pull request list whole too", async () => {
		spyOn(githubQuota, "admit").mockResolvedValue();
		spyOn(proc, "runJson").mockImplementation(async argv => {
			if (argv.includes("rate_limit")) return rateLimit(0, Date.now() + 60 * MINUTE);
			throw new Error("API rate limit exceeded");
		});
		try {
			await inWorkspace(async dir => {
				await expect(loadPullRequests([dir], true)).rejects.toBeInstanceOf(GitHubQuotaError);
			});
		} finally {
			// GitHubAccess keeps the cooldown on disk, under the test run's XDG_CONFIG_HOME; later tests read GraphQL again.
			rmSync(join(process.env.XDG_CONFIG_HOME!, "omp-agents", "github"), { recursive: true, force: true });
		}
	});
});
