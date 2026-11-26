import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromPartial } from "@total-typescript/shoehorn";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import type { RosterHost } from "../shared/sessions";
import { CHANGE_HOLD_MS, PullRequestWatches, PullRequestWatchesFile, UNLISTED_GRACE_MS } from "./pull-request-watches";

const NOW = 1_700_000_000_000;
const URL = "https://github.com/acme/app/pull/12";

const summary = (over: Partial<PullRequestSummary> = {}): PullRequestSummary =>
	fromPartial<PullRequestSummary>({ owner: "acme", repo: "app", number: 12, state: "open", checks: "pending", review: "review-required", unresolved: { count: 0, exact: true, bots: 0 }, ...over });

const listOf = (...pullRequests: PullRequestSummary[]): PullRequestList => ({ repos: [{ owner: "acme", repo: "app", cwds: ["/w"], pullRequests }], unmatched: [] });

function setup({ active = true } = {}) {
	const path = join(mkdtempSync(join(tmpdir(), "pr-watches-")), "pull-request-watches.json");
	const file = new PullRequestWatchesFile(path);
	const hosts = [fromPartial<RosterHost>({ instanceId: "i1", sessionId: "s1" }), fromPartial<RosterHost>({ instanceId: "i2", sessionId: "s2" })];
	const woken: [string, string][] = [];
	let now = NOW;
	const make = (from: PullRequestWatchesFile) =>
		new PullRequestWatches({
			file: from,
			hosts: () => hosts,
			wake: async (sessionId, text) => void woken.push([sessionId, text]),
			active: () => active,
			now: () => now,
		});
	const watches = make(file);
	const call = (args: Record<string, unknown>, caller = "i1") =>
		watches.join(caller).rpc.tools[0]!.execute(args, { toolCallId: "c1", signal: new AbortController().signal });
	return { watches, file, path, woken, call, make, later: (ms: number) => void (now += ms) };
}

/** Reads `list` twice, a hold apart, so a change it shows wakes. */
function settle(watches: PullRequestWatches, list: PullRequestList, later: (ms: number) => void) {
	watches.learn(list);
	later(CHANGE_HOLD_MS);
	watches.learn(list);
}

describe("pull request watches", () => {
	test("checks failing wakes the watching session once, after the change held for a minute", async () => {
		const { watches, woken, call, later } = setup();
		watches.learn(listOf(summary()));
		await call({ url: URL });
		watches.learn(listOf(summary({ checks: "failing" })));
		later(CHANGE_HOLD_MS - 1);
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(woken).toEqual([]);
		later(1);
		watches.learn(listOf(summary({ checks: "failing" })));
		later(CHANGE_HOLD_MS);
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(woken).toEqual([["s1", expect.stringContaining("acme/app#12")]]);
		expect(woken[0]![1]).toContain("checks pending → failing. Act on it now.");
	});

	test("checks passing, an approval, resolved threads, and checks starting again record the state without waking", async () => {
		const { watches, file, woken, call, later } = setup();
		watches.learn(listOf(summary({ unresolved: { count: 2, exact: true, bots: 0 } })));
		await call({ url: URL });
		for (const state of [
			summary({ checks: "passing", unresolved: { count: 2, exact: true, bots: 0 } }),
			summary({ checks: "passing", review: "approved", unresolved: { count: 1, exact: true, bots: 0 } }),
			summary({ checks: "pending", review: "approved", state: "draft", unresolved: { count: 1, exact: true, bots: 0 } }),
		])
			settle(watches, listOf(state), later);
		expect(woken).toEqual([]);
		expect(file.value[0]!.seen).toEqual({ state: "draft", checks: "pending", review: "approved", unresolved: 1 });
		settle(watches, listOf(summary({ checks: "failing", review: "approved", unresolved: { count: 1, exact: true, bots: 0 } })), later);
		expect(woken).toHaveLength(1);
		expect(woken[0]![1]).toContain("changed: checks pending → failing. Act on it now.");
	});

	test("changes requested or more unresolved threads wake once, naming the net change", async () => {
		const { watches, woken, call, later } = setup();
		await call({ url: URL });
		watches.learn(listOf(summary()));
		expect(woken).toEqual([]);
		watches.learn(listOf(summary({ review: "changes-requested" })));
		later(CHANGE_HOLD_MS);
		watches.learn(listOf(summary({ review: "changes-requested", unresolved: { count: 2, exact: true, bots: 1 } })));
		expect(woken).toHaveLength(1);
		expect(woken[0]![1]).toContain("review decision review required → changes requested; unresolved review threads 0 → 2");
		settle(watches, listOf(summary({ review: "changes-requested", unresolved: { count: 3, exact: true, bots: 1 } })), later);
		expect(woken).toHaveLength(2);
		expect(woken[1]![1]).toContain("changed: unresolved review threads 2 → 3. Act on it now.");
	});

	test("a change undone within the hold wakes nothing", async () => {
		const { watches, woken, call, later } = setup();
		watches.learn(listOf(summary({ checks: "passing" })));
		await call({ url: URL });
		watches.learn(listOf(summary({ checks: "failing" })));
		later(30_000);
		watches.learn(listOf(summary({ checks: "passing" })));
		later(CHANGE_HOLD_MS);
		watches.learn(listOf(summary({ checks: "passing" })));
		expect(woken).toEqual([]);
		watches.learn(listOf(summary({ checks: "failing" })));
		later(CHANGE_HOLD_MS - 1);
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(woken).toEqual([]);
	});

	test("a ready watch also wakes once checks pass and the pull request is approved", async () => {
		const { watches, woken, call, later } = setup();
		watches.learn(listOf(summary()));
		expect(await call({ url: URL, ready: true })).toContain("Watching acme/app#12");
		settle(watches, listOf(summary({ checks: "passing" })), later);
		expect(woken).toEqual([]);
		settle(watches, listOf(summary({ checks: "passing", review: "approved" })), later);
		expect(woken).toEqual([["s1", expect.stringContaining("review decision review required → approved. Act on it now.")]]);
	});

	test("only the session that last watched a pull request is woken", async () => {
		const { watches, file, woken, call, later } = setup();
		watches.learn(listOf(summary()));
		await call({ url: URL });
		later(1);
		expect(await call({ url: URL }, "i2")).toContain("took the watch over from session s1");
		expect(file.value.map(watch => watch.sessionId)).toEqual(["s2"]);
		expect(await call({ url: URL, stop: true })).toContain("was not watching");
		settle(watches, listOf(summary({ checks: "failing" })), later);
		expect(woken).toEqual([["s2", expect.stringContaining("checks pending → failing")]]);
	});

	test("a file holding several watches of one pull request keeps and wakes only the newest", async () => {
		const { path, woken, later, make } = setup();
		const seen = { state: "open" as const, checks: "pending" as const, review: "review-required" as const, unresolved: 0 };
		const pr = { owner: "acme", repo: "app", number: 12 };
		writeFileSync(
			path,
			JSON.stringify({
				watches: [
					{ sessionId: "s1", pr, since: NOW, seen },
					{ sessionId: "s2", pr, since: NOW + 1, seen },
				],
			}),
		);
		const file = new PullRequestWatchesFile(path);
		const watches = make(file);
		settle(watches, listOf(summary({ checks: "failing" })), later);
		expect(woken).toEqual([["s2", expect.stringContaining("checks pending → failing")]]);
		expect(file.value.map(watch => watch.sessionId)).toEqual(["s2"]);
	});

	test("a merge wakes once and ends the watch", async () => {
		const { watches, file, woken, call } = setup();
		watches.learn(listOf(summary()));
		await call({ url: URL });
		watches.learn(listOf(summary({ state: "merged", checks: "passing" })));
		expect(woken).toEqual([["s1", expect.stringContaining("merged, so the dashboard stopped watching it")]]);
		expect(file.value).toEqual([]);
		expect(watches.watching()).toBe(false);
		watches.learn(listOf(summary({ state: "merged", checks: "failing" })));
		expect(woken).toHaveLength(1);
	});

	test("leaving the list after it was seen ends the watch as closed; one never listed ends after the grace", async () => {
		const closed = setup();
		closed.watches.learn(listOf(summary()));
		await closed.call({ url: URL });
		closed.watches.learn(listOf());
		expect(closed.woken).toEqual([["s1", expect.stringContaining("most likely closed")]]);
		expect(closed.file.value).toEqual([]);

		const unlisted = setup();
		await unlisted.call({ url: URL });
		unlisted.watches.learn(listOf());
		expect(unlisted.woken).toEqual([]);
		unlisted.later(UNLISTED_GRACE_MS);
		unlisted.watches.learn(listOf());
		expect(unlisted.woken).toEqual([["s1", expect.stringContaining("never saw")]]);
		expect(unlisted.file.value).toEqual([]);
	});

	test("a repository the list has no answer for keeps its watches as they were", async () => {
		const { watches, woken, file, call } = setup();
		watches.learn(listOf(summary()));
		await call({ url: URL });
		watches.learn({ repos: [{ owner: "acme", repo: "app", cwds: ["/w"], error: "GitHub quota low" }], unmatched: [] });
		expect(woken).toEqual([]);
		expect(file.value).toHaveLength(1);
	});

	test("a server that does not own the unattended work wakes nothing and keeps the state", async () => {
		const { watches, woken, file, call } = setup({ active: false });
		await call({ url: URL });
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(woken).toEqual([]);
		expect(file.value[0]!.seen).toBeNull();
	});

	test("watches survive a restart, which a new file of the same path reads", async () => {
		const { path, call } = setup();
		await call({ url: URL });
		expect(new PullRequestWatchesFile(path).value).toEqual([{ sessionId: "s1", pr: { owner: "acme", repo: "app", number: 12 }, since: NOW, seen: null }]);
	});
});

describe("the watch_pull_request tool", () => {
	test("watches once per session and pull request, reports the last state it read, and stops on request", async () => {
		const { watches, file, call } = setup();
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(await call({ url: `${URL}/files` })).toContain("checks failing");
		await call({ url: URL });
		expect(file.value).toHaveLength(1);
		expect(await call({ url: URL, stop: true })).toContain("Stopped watching acme/app#12");
		expect(file.value).toEqual([]);
		expect(await call({ url: URL, stop: true })).toContain("was not watching");
	});

	test("refuses a bad address, a merged pull request, and a caller not listed yet, saving nothing", async () => {
		const { watches, file, call } = setup();
		expect(call({ url: "https://example.com/acme/app/pull/12" })).rejects.toThrow("url must be a GitHub pull request address");
		expect(call({ url: URL }, "i9")).rejects.toThrow("This session is not listed yet");
		watches.learn(listOf(summary({ state: "merged" })));
		expect(await call({ url: URL })).toContain("already merged");
		expect(file.value).toEqual([]);
	});
});
