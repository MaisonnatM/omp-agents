import { afterEach, describe, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghGraphql, githubQuota, ghPolledGraphql } from "./github";
import { GithubQuota, GithubQuotaPaused, GRAPHQL_RESERVE, type GraphqlQuota, parseRateLimit, pausedText } from "./github-quota";
import * as proc from "./proc";
import { runChecked } from "./proc";
import { loadPullRequests } from "./pull-requests";

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

	test("a refusal pauses until the reset it reads, and refusals while paused read nothing", async () => {
		setSystemTime(NOW);
		const reset = NOW + 30 * MINUTE;
		const { quota, reads } = gate(() => ({ remaining: 0, reset }));
		const pauses = await Promise.all([quota.refused(), quota.refused()]);
		expect(pauses.map(pause => pause.message)).toEqual([pausedText(reset), pausedText(reset)]);
		expect(reads.count).toBe(1);
		await quota.refused();
		await expect(quota.admit()).rejects.toThrow(pausedText(reset));
		expect(reads.count).toBe(1);
	});

	test("a refusal with no reset to read pauses for 15 minutes", async () => {
		setSystemTime(NOW);
		const { quota } = gate(() => null);
		expect((await quota.refused()).message).toBe(pausedText(NOW + 15 * MINUTE));
		setSystemTime(NOW + 16 * MINUTE);
		await quota.admit();
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

	test("GitHub refusing a call for its rate limit, in its answer or as gh's error, tells the quota once and throws its pause", async () => {
		const refused = spyOn(githubQuota, "refused").mockResolvedValue(pause);
		github(() => ({ errors: [{ type: "RATE_LIMITED", message: "API rate limit already exceeded for user ID 27284940." }] }));
		await expect(ghGraphql("mutation", {})).rejects.toBe(pause);
		spyOn(proc, "runJson").mockRejectedValue(new Error("gh: API rate limit exceeded for user ID 27284940."));
		await expect(ghGraphql("mutation", {})).rejects.toBe(pause);
		expect(refused).toHaveBeenCalledTimes(2);
	});

	test("while polling is paused, the pull request list fails whole, so the page keeps the list it has", async () => {
		spyOn(githubQuota, "admit").mockRejectedValue(pause);
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-github-quota-"));
		try {
			await runChecked(["git", "init", "-q", dir]);
			await runChecked(["git", "-C", dir, "remote", "add", "origin", "git@github.com:acme/quota.git"]);
			const calls = github();
			await expect(loadPullRequests([dir], true)).rejects.toBe(pause);
			expect(calls).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
