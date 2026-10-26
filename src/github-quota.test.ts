import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghGraphql, ghPolledGraphql } from "./github";
import { GRAPHQL_RESERVE, GithubQuotaPaused, parseRateLimit, pausedText } from "./github-quota";
import * as proc from "./proc";
import { runChecked } from "./proc";
import { loadPullRequests } from "./pull-requests";

afterEach(() => {
	mock.restore();
	setSystemTime();
});

const MINUTE = 60_000;

/**
 * The gate is one per server, so each test starts hours after the last, past every reset and kept quota before it,
 * and before the real clock, so no test leaves the gate closed for another file.
 */
const startOf = (test: number): number => Date.parse("2026-01-01T00:00:00Z") + test * 6 * 60 * MINUTE;

/** `gh api rate_limit`'s answer with `remaining` GraphQL points left until `reset`. */
const rateLimit = (remaining: number, reset: number) => ({
	resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: reset / 1000 }, graphql: { limit: 5000, used: 5000 - remaining, remaining, reset: reset / 1000 } },
});

/** Answers `gh api rate_limit` with `quota()` and every GraphQL call with `graphql()`, listing the GraphQL calls. */
function github(quota: () => unknown, graphql: () => unknown = () => ({ data: {} })): string[][] {
	const calls: string[][] = [];
	spyOn(proc, "runJson").mockImplementation(async argv => {
		if (argv[2] === "rate_limit") return quota();
		calls.push(argv);
		return graphql();
	});
	return calls;
}

test("the GraphQL quota comes from gh api rate_limit, its reset in milliseconds", () => {
	expect(parseRateLimit(rateLimit(42, 1_700_000_000_000))).toEqual({ remaining: 42, reset: 1_700_000_000_000 });
	expect(parseRateLimit({ message: "Bad credentials" })).toBeNull();
});

test("below the reserve, a polled read asks GitHub nothing until the reset, a user's call still runs, and polling resumes after it", async () => {
	const start = startOf(1);
	setSystemTime(start);
	const reset = start + 20 * MINUTE;
	let quota = rateLimit(GRAPHQL_RESERVE - 1, reset);
	const calls = github(() => quota);
	await expect(ghPolledGraphql("query", {})).rejects.toBeInstanceOf(GithubQuotaPaused);
	await expect(ghPolledGraphql("query", {})).rejects.toThrow(pausedText(reset));
	expect(calls).toEqual([]);
	await ghGraphql("mutation", {});
	expect(calls).toHaveLength(1);
	setSystemTime(reset + MINUTE);
	quota = rateLimit(5000, reset + 60 * MINUTE);
	expect(await ghPolledGraphql("query", {})).toEqual({ data: {} });
	expect(calls).toHaveLength(2);
});

test("GitHub refusing a read for its rate limit pauses polled reads until the reset rather than retrying them", async () => {
	const start = startOf(2);
	setSystemTime(start);
	const reset = start + 30 * MINUTE;
	let quota = rateLimit(4000, reset);
	let refuse = true;
	const calls = github(
		() => quota,
		() => {
			if (!refuse) return { data: {} };
			refuse = false;
			quota = rateLimit(0, reset);
			return { errors: [{ type: "RATE_LIMITED", message: "API rate limit already exceeded for user ID 27284940." }] };
		},
	);
	await expect(ghPolledGraphql("query", {})).rejects.toThrow(pausedText(reset));
	expect(calls).toHaveLength(1);
	setSystemTime(reset - MINUTE);
	await expect(ghPolledGraphql("query", {})).rejects.toThrow(pausedText(reset));
	expect(calls).toHaveLength(1);
	setSystemTime(reset + MINUTE);
	quota = rateLimit(5000, reset + 60 * MINUTE);
	expect(await ghPolledGraphql("query", {})).toEqual({ data: {} });
	expect(calls).toHaveLength(2);
});

test("a refusal gh reports as an error, with no quota to read, pauses polled reads for 15 minutes", async () => {
	const start = startOf(3);
	setSystemTime(start);
	spyOn(proc, "runJson").mockImplementation(async argv => {
		throw new Error(argv[2] === "rate_limit" ? "gh: connection refused" : "gh: API rate limit exceeded for user ID 27284940.");
	});
	await expect(ghGraphql("query", {})).rejects.toThrow("API rate limit exceeded");
	await expect(ghPolledGraphql("query", {})).rejects.toThrow(pausedText(start + 15 * MINUTE));
});

test("while polling is paused, the pull request list fails whole, so the page keeps the list it has", async () => {
	const start = startOf(4);
	setSystemTime(start);
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-github-quota-"));
	try {
		await runChecked(["git", "init", "-q", dir]);
		await runChecked(["git", "-C", dir, "remote", "add", "origin", "git@github.com:acme/quota.git"]);
		const calls = github(() => rateLimit(10, start + 10 * MINUTE));
		await expect(loadPullRequests([dir], true)).rejects.toThrow(pausedText(start + 10 * MINUTE));
		expect(calls).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
