import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Inbox, InboxPullRequest } from "../shared/github";
import type { AgentState } from "../shared/moves";
import type { ModelUpdate, Notice } from "../shared/notices";
import type { SlackFound } from "../slack-messages";
import { ACTIVITY_KINDS, Notices, type NoticeSources, UPDATE_KINDS } from "./notices";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function noticesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-notices-"));
	dirs.push(dir);
	return join(dir, "notices.json");
}

const opus: ModelUpdate = {
	provider: "anthropic",
	from: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
	to: { id: "claude-opus-5-6", name: "Claude Opus 5.6" },
	uses: ["default", "smol fallbacks"],
};
const OPUS_ID = "model:anthropic/claude-opus-5-5>claude-opus-5-6";

const MINUTE = 60_000;

const pr = (number: number, fields: Partial<InboxPullRequest> = {}): InboxPullRequest => ({
	owner: "acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	author: { login: "ana", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "approved",
	checks: "passing",
	conflicts: false,
	additions: 1,
	deletions: 1,
	head: `branch-${number}`,
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	updatedAt: 1_000,
	...fields,
});

interface State {
	latest: string | null;
	installed: string;
	models: ModelUpdate[];
	fail?: string;
	pullRequests?: InboxPullRequest[];
	/** The answer GitHub gave for the repository instead of its pull requests. */
	githubError?: string;
	agents?: Record<number, AgentState>;
	slack?: SlackFound[];
	now?: number;
}

/** Sources whose answers a test changes as it goes: `installed` moves when `updateOmp` succeeds. */
function sources(state: State): NoticeSources {
	return {
		latestOmp: async () => {
			if (state.fail) throw new Error(state.fail);
			return state.latest;
		},
		installedOmp: () => state.installed,
		updateOmp: async latest => {
			state.installed = latest;
			return latest;
		},
		modelUpdates: async () => {
			if (state.fail) throw new Error(state.fail);
			return state.models;
		},
		upgradeModel: async update => {
			state.models = state.models.filter(model => model !== update);
		},
		inbox: async () => {
			const repo = { owner: "acme", repo: "webapp", cwds: ["/code/webapp"] };
			const inbox: Inbox = { repos: [state.githubError ? { ...repo, error: state.githubError } : { ...repo, pullRequests: state.pullRequests ?? [] }], unmatched: [] };
			return { inbox, agent: ({ number }) => state.agents?.[number] ?? null };
		},
		slack: async () => state.slack ?? [],
		now: () => state.now ?? 0,
	};
}

const statusOf = (notice: Notice): string | null => ("status" in notice ? notice.status.state : null);

describe("Notices", () => {
	test("a newer omp and a newer model each make one notice; seen and clear survive a restart, and a newer release is a new notice", async () => {
		const path = noticesPath();
		const state: State = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const first = new Notices(path, sources(state), () => {});
		await first.check(UPDATE_KINDS);
		expect(first.list.map(notice => [notice.id, notice.seen, statusOf(notice)])).toEqual([
			["omp:18.8.4", false, "available"],
			[OPUS_ID, false, "available"],
		]);
		await first.apply(["omp:18.8.4"], "seen");
		await first.apply([OPUS_ID], "clear");

		const second = new Notices(path, sources(state), () => {});
		await second.check(UPDATE_KINDS);
		expect(second.list.map(({ id, seen }) => [id, seen])).toEqual([["omp:18.8.4", true]]);

		state.latest = "18.9.0";
		await second.check(UPDATE_KINDS);
		expect(second.list.map(({ id, seen }) => [id, seen])).toEqual([["omp:18.9.0", false]]);
	});

	test("an update shows its outcome after the check no longer finds it, and a failed one can run again", async () => {
		const state: State = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(UPDATE_KINDS);

		await notices.apply([OPUS_ID, "omp:18.8.4"], "update");
		expect(notices.list.map(notice => [notice.id, notice.seen, notice.read, "status" in notice && notice.status])).toEqual([
			["omp:18.8.4", true, true, { state: "updated", note: "omp 18.8.4 is installed. Restart omp-agents to load it." }],
			[OPUS_ID, true, true, { state: "updated", note: "default and smol fallbacks use Claude Opus 5.6 now." }],
		]);

		state.latest = "18.8.5";
		const base = sources(state);
		let attempts = 0;
		const flaky = new Notices(noticesPath(), { ...base, updateOmp: async latest => (++attempts === 1 ? Promise.reject(new Error("Update failed: offline")) : base.updateOmp(latest)) }, () => {});
		await flaky.check(UPDATE_KINDS);
		await flaky.apply(["omp:18.8.5"], "update");
		expect(flaky.list.map(notice => "status" in notice && notice.status)[0]).toEqual({ state: "failed", error: "Update failed: offline" });
		await flaky.apply(["omp:18.8.5"], "update");
		expect(flaky.list.map(notice => "status" in notice && notice.status)[0]).toEqual({ state: "updated", note: "omp 18.8.5 is installed. Restart omp-agents to load it." });
	});

	test("a check that fails keeps the notices and marks the last one found", async () => {
		const path = noticesPath();
		const state: State = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const first = new Notices(path, sources(state), () => {});
		await first.check(UPDATE_KINDS);
		await first.apply([OPUS_ID], "seen");

		state.fail = "offline";
		const second = new Notices(path, sources(state), () => {});
		await second.check(UPDATE_KINDS);
		expect(second.list).toEqual([]);
		await first.check(UPDATE_KINDS);
		expect(first.list.map(({ id }) => id)).toEqual(["omp:18.8.4", OPUS_ID]);

		state.fail = undefined;
		await second.check(UPDATE_KINDS);
		expect(second.list.find(({ id }) => id === OPUS_ID)?.seen).toBe(true);
	});

	test("a pull request notifies while its next move is yours, not while a session works on it or it waits on others", async () => {
		const state: State = {
			latest: null,
			installed: "18.8.0",
			models: [],
			pullRequests: [pr(1), pr(2, { role: "reviewer" }), pr(3, { checks: "pending" }), pr(4, { checks: "failing" }), pr(5, { conflicts: true }), pr(6, { review: "changes-requested" })],
			agents: { 4: "working" },
		};
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(ACTIVITY_KINDS);
		expect(notices.list.map(notice => (notice.kind === "pull-request" ? [notice.pr.number, notice.move, notice.cwd] : null))).toEqual([
			[1, "merge", "/code/webapp"],
			[2, "review", "/code/webapp"],
			[5, "rebase", "/code/webapp"],
			[6, "reply", "/code/webapp"],
		]);
	});

	test("read and clear last while a pull request stays in its move, and a move it comes back to after a while is news again", async () => {
		const path = noticesPath();
		const state: State = { latest: null, installed: "18.8.0", models: [], pullRequests: [pr(1), pr(2, { role: "reviewer" })], now: 100 * MINUTE };
		const MERGE_1 = "pull-request:acme/webapp#1:merge";
		const REVIEW_2 = "pull-request:acme/webapp#2:review";
		const first = new Notices(path, sources(state), () => {});
		await first.check(ACTIVITY_KINDS);
		await first.apply([MERGE_1], "read");
		await first.apply([REVIEW_2], "clear");

		const second = new Notices(path, sources(state), () => {});
		await second.check(ACTIVITY_KINDS);
		expect(second.list.map(({ id, read }) => [id, read])).toEqual([[MERGE_1, true]]);

		state.pullRequests = [pr(1, { checks: "pending" }), pr(2, { role: "reviewer" })];
		state.now = 102 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		expect(second.list).toEqual([]);
		state.pullRequests = [pr(1), pr(2, { role: "reviewer" })];
		state.now = 104 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		expect(second.list.map(({ id, read }) => [id, read])).toEqual([[MERGE_1, true]]);

		state.pullRequests = [pr(1, { checks: "failing" })];
		state.now = 106 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		state.now = 120 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		state.pullRequests = [pr(1), pr(2, { role: "reviewer" })];
		state.now = 122 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		expect(second.list.map(({ id, at, read }) => [id, at, read])).toEqual([
			[MERGE_1, 122 * MINUTE, false],
			[REVIEW_2, 122 * MINUTE, false],
		]);
	});

	test("the first check dates each notice by its own time, a later one by the check, and Slack by the message", async () => {
		const message: SlackFound = { id: "slack:D1:1.0", at: 5 * MINUTE, kind: "slack", type: "dm", count: 1, from: "Ana", text: "hi", permalink: "https://slack.test/p1" };
		const state: State = { latest: null, installed: "18.8.0", models: [], pullRequests: [pr(1, { updatedAt: 1_000 })], slack: [message], now: 50 * MINUTE };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(ACTIVITY_KINDS);
		state.pullRequests = [pr(1, { updatedAt: 1_000 }), pr(2, { role: "reviewer", updatedAt: 2_000 })];
		state.slack = [message, { ...message, id: "slack:D2:2.0", at: 40 * MINUTE }];
		state.now = 52 * MINUTE;
		await notices.check(ACTIVITY_KINDS);
		expect(notices.list.map(({ id, at }) => [id, at])).toEqual([
			["pull-request:acme/webapp#2:review", 52 * MINUTE],
			["slack:D2:2.0", 40 * MINUTE],
			["slack:D1:1.0", 5 * MINUTE],
			["pull-request:acme/webapp#1:merge", 1_000],
		]);
	});

	test("a repository GitHub does not answer for keeps its pull requests' notices", async () => {
		const state: State = { latest: null, installed: "18.8.0", models: [], pullRequests: [pr(1)] };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(ACTIVITY_KINDS);
		state.githubError = "GitHub answered HTTP 502";
		await notices.check(ACTIVITY_KINDS);
		expect(notices.list.map(({ id }) => id)).toEqual(["pull-request:acme/webapp#1:merge"]);
	});

	test("a repository that answers only after the first check dates its pull requests by their own time, not as news", async () => {
		const state: State = { latest: null, installed: "18.8.0", models: [], pullRequests: [pr(1, { updatedAt: 1_000 })], githubError: "GitHub answered HTTP 502", now: 50 * MINUTE };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(ACTIVITY_KINDS);
		state.githubError = undefined;
		state.now = 52 * MINUTE;
		await notices.check(ACTIVITY_KINDS);
		state.pullRequests = [pr(1, { updatedAt: 1_000 }), pr(2, { role: "reviewer", updatedAt: 2_000 })];
		state.now = 54 * MINUTE;
		await notices.check(ACTIVITY_KINDS);
		expect(notices.list.map(({ id, at }) => [id, at])).toEqual([
			["pull-request:acme/webapp#2:review", 54 * MINUTE],
			["pull-request:acme/webapp#1:merge", 1_000],
		]);
	});
});
