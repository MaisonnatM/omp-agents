import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PULL_REQUEST_ACTIONS } from "../pull-request-actions";
import type { Bot, BotId } from "../shared/bots";
import type { PullRequestSummary } from "../shared/github";
import type { MergeQueueChange } from "../shared/merge-queue";
import type { StartRequest } from "../shared/sessions";
import type { ShepherdRequest } from "../shared/shepherd";
import { ShepherdInbox } from "./shepherd-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const shepherd: Bot = { id: "herd" as BotId, kind: "pr-shepherd", name: "Shepherd", job: "", cwd: "/work", model: null, skill: null, shape: "pill", hue: 25, sessionId: "s1", createdAt: "2026-10-30T09:00:00.000Z", pinned: false, section: null };
const helper: Bot = { ...shepherd, id: "helper" as BotId, kind: "routines", name: "Helper" };

const pr = (fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
	owner: "acme",
	repo: "webapp",
	number: 7,
	title: "Add widgets",
	author: { login: "me", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "approved",
	checks: "failing",
	conflicts: false,
	additions: 1,
	deletions: 0,
	head: "me/widgets",
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	updatedAt: 1,
	...fields,
});

const target = { owner: "acme", repo: "webapp", number: 7 };
const fixCi: ShepherdRequest = { botId: shepherd.id, change: { op: "fix", pr: target, action: "fix-ci" } };
const merge: ShepherdRequest = { botId: shepherd.id, change: { op: "merge", pr: target, method: "squash" } };

/** An inbox over `listed`, the one pull request GitHub reports, with `working` a session on it and `unapproved` the answer of the approval check. */
function inbox({ listed = pr(), working = false, unapproved = null as string | null } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-shepherd-inbox-"));
	dirs.push(dir);
	const inboxDir = join(dir, "shepherd-inbox");
	mkdirSync(inboxDir);
	const state = { listed, busy: false };
	const started: StartRequest[] = [];
	const queued: MergeQueueChange[] = [];
	const told: string[] = [];
	const box = new ShepherdInbox(inboxDir, {
		bots: () => [shepherd, helper],
		pullRequests: async () => ({ repos: [{ owner: "acme", repo: "webapp", cwds: ["/code/webapp"], pullRequests: [state.listed] }], unmatched: [] }),
		agent: () => () => (working || state.busy ? "working" : null),
		start: async request => {
			await Promise.resolve();
			state.busy = true;
			started.push(request);
			return { ok: true, instanceId: `i${started.length}`, workspace: "/code/webapp", prompt: null };
		},
		queueMerge: async change => void queued.push(change),
		unapprovedChange: async () => unapproved,
		tell: async (_botId, text) => void told.push(text),
	});
	let n = 0;
	const send = async (request: unknown) => {
		writeFileSync(join(inboxDir, `${++n}-x.json`), JSON.stringify(request));
		await box.drain();
	};
	const left = () => readdirSync(inboxDir);
	return { send, started, queued, told, left, state, inboxDir, drainAll: () => box.drain(), finish: () => void (state.busy = false) };
}

test("a fix starts its quick action's session on the pull request's branch, linked to it, and a third start of the same fix is refused", async () => {
	const { send, started, told, left, finish } = inbox();
	await send(fixCi);
	finish();
	await send(fixCi);
	finish();
	await send(fixCi);
	expect(started).toHaveLength(2);
	expect(started[0]).toMatchObject({
		kind: "new",
		cwd: "/code/webapp",
		prompt: PULL_REQUEST_ACTIONS["fix-ci"].prompt(pr()),
		branch: { kind: "work", name: "me/widgets" },
		subject: { kind: "pull-request", pr: target },
		bot: null,
	});
	expect(told).toEqual(["The dashboard did not start fix-ci on acme/webapp#7: fix-ci already ran 2 times on it."]);
	expect(left()).toEqual([]);
});

test("two requests for the same fix dropped at once start one session, since the second sees the first one working", async () => {
	const { started, told, inboxDir, drainAll } = inbox();
	writeFileSync(join(inboxDir, "1-a.json"), JSON.stringify(fixCi));
	writeFileSync(join(inboxDir, "1-b.json"), JSON.stringify(fixCi));
	await drainAll();
	expect(started).toHaveLength(1);
	expect(told).toEqual(["The dashboard did not start fix-ci on acme/webapp#7: a session already works on it."]);
});

test("a fix is refused, and the Bot told why, for a pull request that is not approved, not yours, worked on, or without that problem", async () => {
	const cases: [Parameters<typeof inbox>[0], string][] = [
		[{ listed: pr({ review: "review-required" }) }, "it is not approved"],
		[{ listed: pr({ role: "reviewer" }) }, "you did not write it"],
		[{ listed: pr({ state: "draft" }) }, "it is a draft"],
		[{ working: true }, "a session already works on it"],
		[{ listed: pr({ checks: "passing" }) }, "fix-ci does not apply to it now"],
		[{ listed: pr({ number: 8 }) }, "it is not among the open pull requests of the dashboard's workspaces"],
	];
	for (const [options, why] of cases) {
		const { send, started, told } = inbox(options);
		await send(fixCi);
		expect(started).toEqual([]);
		expect(told).toEqual([`The dashboard did not start fix-ci on acme/webapp#7: ${why}.`]);
	}
});

test("a merge is queued with the Bot's method once nothing blocks it, and refused while checks fail or the head changed what was approved", async () => {
	const ready = inbox({ listed: pr({ checks: "pending" }) });
	await ready.send(merge);
	expect(ready.queued).toEqual([{ op: "add", method: "squash", prs: [{ ...target, head: null }] }]);
	expect(ready.told).toEqual([]);

	const failing = inbox();
	await failing.send(merge);
	expect(failing.queued).toEqual([]);
	expect(failing.told).toEqual(["The dashboard did not queue the merge of acme/webapp#7: it still has conflicts, failing checks, or open review threads."]);

	const changed = inbox({ listed: pr({ checks: "passing" }), unapproved: "its head changes code no reviewer approved" });
	await changed.send(merge);
	expect(changed.queued).toEqual([]);
	expect(changed.told).toEqual(["The dashboard did not queue the merge of acme/webapp#7: its head changes code no reviewer approved; ask the user to review it again."]);
});

test("a request from a Bot that is not a PR shepherd, or that is no request, is set aside and does nothing", async () => {
	const { send, started, queued, told, left, inboxDir } = inbox();
	await send({ ...fixCi, botId: helper.id });
	await send({ botId: shepherd.id, change: { op: "fix", pr: target, action: "review" } });
	expect(started).toEqual([]);
	expect(queued).toEqual([]);
	expect(told).toEqual([]);
	expect(left().toSorted()).toEqual(["1-x.json.invalid", "2-x.json.invalid"]);
	expect(existsSync(join(inboxDir, "1-x.json"))).toBe(false);
});
