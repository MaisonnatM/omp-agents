import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromPartial } from "@total-typescript/shoehorn";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import type { RosterHost } from "../shared/sessions";
import { promptAuthor } from "../shared/transcript";
import { CHANGE_HOLD_MS, PullRequestWatches, PullRequestWatchesFile } from "./pull-request-watches";

const summary = (over: Partial<PullRequestSummary>): PullRequestSummary =>
	fromPartial<PullRequestSummary>({ owner: "acme", repo: "app", number: 12, state: "open", checks: "pending", review: "review-required", unresolved: { count: 0, exact: true, bots: 0 }, ...over });

const listOf = (pr: PullRequestSummary): PullRequestList => ({ repos: [{ owner: "acme", repo: "app", cwds: ["/w"], pullRequests: [pr] }], unmatched: [] });

test("a pull request watch's wake reads as the dashboard's prompt, which the transcript hides", async () => {
	const woken: string[] = [];
	let now = 1_700_000_000_000;
	const watches = new PullRequestWatches({
		file: new PullRequestWatchesFile(join(mkdtempSync(join(tmpdir(), "pr-wake-")), "w.json")),
		hosts: () => [fromPartial<RosterHost>({ instanceId: "i1", sessionId: "s1" })],
		wake: async (_sessionId, text) => void woken.push(text),
		active: () => true,
		now: () => now,
	});
	watches.learn(listOf(summary({})));
	await watches.join("i1").rpc.tools[0]!.execute({ url: "https://github.com/acme/app/pull/12" }, { toolCallId: "c1", signal: new AbortController().signal });
	watches.learn(listOf(summary({ checks: "failing" })));
	now += CHANGE_HOLD_MS;
	watches.learn(listOf(summary({ checks: "failing" })));
	expect(woken).toHaveLength(1);
	expect(promptAuthor(woken[0]!)).toEqual({ kind: "dashboard" });
});
