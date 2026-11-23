import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromPartial } from "@total-typescript/shoehorn";
import type { BotId } from "../shared/bots";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import { newSessionRequest, type RosterHost, type StartRequest } from "../shared/sessions";
import { PullRequestWatches, PullRequestWatchesFile, UNLISTED_GRACE_MS } from "./pull-request-watches";

const NOW = 1_700_000_000_000;
const URL = "https://github.com/acme/app/pull/12";

const summary = (over: Partial<PullRequestSummary> = {}): PullRequestSummary =>
	fromPartial<PullRequestSummary>({ owner: "acme", repo: "app", number: 12, state: "open", checks: "pending", review: "review-required", unresolved: { count: 0, exact: true, bots: 0 }, ...over });

const listOf = (...pullRequests: PullRequestSummary[]): PullRequestList => ({ repos: [{ owner: "acme", repo: "app", cwds: ["/w"], pullRequests }], unmatched: [] });

function setup({ active = true } = {}) {
	const path = join(mkdtempSync(join(tmpdir(), "pr-watches-")), "pull-request-watches.json");
	const file = new PullRequestWatchesFile(path);
	const hosts = [fromPartial<RosterHost>({ instanceId: "i1", sessionId: "s1" })];
	const woken: [string, string][] = [];
	let now = NOW;
	const watches = new PullRequestWatches({
		file,
		hosts: () => hosts,
		isBot: request => request.kind === "new" && request.bot !== null,
		wake: async (sessionId, text) => void woken.push([sessionId, text]),
		active: () => active,
		now: () => now,
	});
	const call = (args: Record<string, unknown>, caller = "i1") =>
		watches.join(newSessionRequest("/tmp", "Hi"), caller).rpc.tools[0]!.execute(args, { toolCallId: "c1", signal: new AbortController().signal });
	return { watches, file, path, woken, call, later: (ms: number) => void (now += ms) };
}

describe("pull request watches", () => {
	test("a change in the fetched state wakes the watching session exactly once", async () => {
		const { watches, woken, call } = setup();
		watches.learn(listOf(summary()));
		await call({ url: URL });
		watches.learn(listOf(summary({ checks: "failing" })));
		watches.learn(listOf(summary({ checks: "failing" })));
		expect(woken).toEqual([["s1", expect.stringContaining("acme/app#12")]]);
		expect(woken[0]![1]).toContain("checks pending → failing");
	});

	test("a list with no change wakes nothing, nor does checks starting again after a push", async () => {
		const { watches, woken, call } = setup();
		watches.learn(listOf(summary({ checks: "passing" })));
		await call({ url: URL });
		watches.learn(listOf(summary({ checks: "passing" })));
		watches.learn(listOf(summary({ checks: "pending", state: "draft" })));
		expect(woken).toEqual([]);
		watches.learn(listOf(summary({ checks: "passing" })));
		expect(woken).toHaveLength(1);
	});

	test("a review decision or unresolved thread change wakes once, naming each change", async () => {
		const { watches, woken, call } = setup();
		await call({ url: URL });
		watches.learn(listOf(summary()));
		expect(woken).toEqual([]);
		watches.learn(listOf(summary({ review: "changes-requested", unresolved: { count: 2, exact: true, bots: 1 } })));
		expect(woken).toHaveLength(1);
		expect(woken[0]![1]).toContain("review decision review required → changes requested; unresolved review threads 0 → 2");
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
	test("every dashboard start gets it but a Bot's conversation", () => {
		const { watches } = setup();
		const toolsOf = (request: StartRequest) => watches.join(request, "i1").rpc.tools.map(tool => tool.name);
		expect(toolsOf(newSessionRequest("/tmp", "Hi"))).toEqual(["watch_pull_request"]);
		expect(toolsOf(newSessionRequest("/tmp", "Hi", { bot: "scout" as BotId }))).toEqual([]);
	});

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
