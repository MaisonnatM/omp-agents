import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import type { PlanUsage, PlanWindow } from "../shared/models";
import type { AgentState } from "../shared/moves";
import type { CreditsSubject, ModelUpdate, Notice } from "../shared/notices";
import type { SlackFound } from "../slack-messages";
import { InterruptedSessions } from "./interrupted";
import { ACTIVITY_KINDS, DASHBOARD_KINDS, EVENT_KINDS, type FoundEvent, Notices, type NoticeSources, PROVIDER_KINDS, STOPPED_KINDS, UPDATE_KINDS } from "./notices";

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

const pr = (number: number, fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
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
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true },
	conversations: 0,
	updatedAt: 1_000,
	...fields,
});

interface State {
	latest: string | null;
	installed: string;
	models: ModelUpdate[];
	fail?: string;
	pullRequests?: PullRequestSummary[];
	/** The answer GitHub gave for the repository instead of its pull requests. */
	githubError?: string;
	agents?: Record<number, AgentState>;
	slack?: SlackFound[];
	plans?: PlanUsage[];
	usageError?: string;
	creditRuns?: Omit<CreditsSubject, "kind">[];
	localEvents?: FoundEvent[];
	googleEvents?: FoundEvent[];
	googleError?: string;
	/** The commits origin's branch holds past the running omp-agents build. */
	dashboardCommits?: number;
	/** Why updating omp-agents is refused, when it is. */
	dashboardRefusal?: string;
	/** How many times the dashboard check fetched omp-agents' branch. */
	dashboardFetches?: number;
	/** The dashboard sessions the server tracks, whose mid-turn stops the stopped check lists. */
	interrupted?: InterruptedSessions;
	/** What each listed session file gives the stopped check. */
	listed?: Record<string, { title: string | null; cwdDisplay: string }>;
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
		dashboardCommits: async () => {
			state.dashboardFetches = (state.dashboardFetches ?? 0) + 1;
			return state.dashboardCommits ? { branch: "main", running: "a1b2c3d4", commits: state.dashboardCommits } : null;
		},
		updateDashboard: async () => {
			if (state.dashboardRefusal) throw new Error(state.dashboardRefusal);
			return { kind: "restarting", from: "a1b2c3d4", to: "e5f6a7b8c9", installed: false };
		},
		pullRequests: async () => {
			const repo = { owner: "acme", repo: "webapp", cwds: ["/code/webapp"] };
			const list: PullRequestList = { repos: [state.githubError ? { ...repo, error: state.githubError } : { ...repo, pullRequests: state.pullRequests ?? [] }], unmatched: [] };
			return { list, agent: ({ number }) => state.agents?.[number] ?? null };
		},
		slack: async () => state.slack ?? [],
		plans: async () => {
			if (state.usageError) throw new Error(state.usageError);
			return state.plans ?? [];
		},
		creditRuns: async () => state.creditRuns ?? [],
		localEvents: () => state.localEvents ?? [],
		googleEvents: async () => {
			if (state.googleError) throw new Error(state.googleError);
			return [{ account: "google-calendar", events: state.googleEvents ?? [] }];
		},
		projects: () => [],
		stoppedSessions: () => (state.interrupted?.midTurn() ?? []).map(sessionId => ({ sessionId, title: state.listed?.[sessionId]?.title ?? null, cwdDisplay: state.listed?.[sessionId]?.cwdDisplay ?? null })),
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

	test("new omp-agents commits grow one notice per running build, whose update refuses with its reason and then restarts without fetching again", async () => {
		const state: State = { latest: null, installed: "18.8.0", models: [], dashboardCommits: 1 };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(DASHBOARD_KINDS);
		state.dashboardCommits = 3;
		await notices.check(DASHBOARD_KINDS);
		expect(notices.list).toEqual([{ id: "dashboard:a1b2c3d4", at: 0, seen: false, read: false, kind: "dashboard", branch: "main", commits: 3, status: { state: "available" } }]);

		state.dashboardRefusal = "/code/omp-agents has changes to tracked files (bun.lock).";
		await notices.apply(["dashboard:a1b2c3d4"], "update");
		expect(notices.list.map(notice => "status" in notice && notice.status)).toEqual([{ state: "failed", error: "/code/omp-agents has changes to tracked files (bun.lock)." }]);

		state.dashboardRefusal = undefined;
		await notices.apply(["dashboard:a1b2c3d4"], "update");
		expect(notices.list.map(notice => "status" in notice && notice.status)).toEqual([{ state: "updated", note: "Restarting omp-agents at e5f6a7b…" }]);
		expect(state.dashboardFetches).toBe(2);
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
		const message: SlackFound = { id: "slack:D1:1.0", at: 5 * MINUTE, kind: "slack", type: "dm", count: 1, from: "Ana", avatarUrl: null, text: "hi", permalink: "https://slack.test/p1" };
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

	test("a marked notice keeps its scope across a restart: a repository that fails keeps its marks, and one that answers without it forgets them after a while", async () => {
		const path = noticesPath();
		const MERGE_1 = "pull-request:acme/webapp#1:merge";
		const state: State = { latest: null, installed: "18.8.0", models: [], pullRequests: [pr(1)], now: 0 };
		/** Whether a fresh server, as after a restart, shows the pull request's notice read. */
		const readAfterRestart = async (): Promise<boolean | undefined> => {
			const restarted = new Notices(path, sources({ ...state, githubError: undefined, pullRequests: [pr(1)] }), () => {});
			await restarted.check(ACTIVITY_KINDS);
			return restarted.list.find(({ id }) => id === MERGE_1)?.read;
		};
		const first = new Notices(path, sources(state), () => {});
		await first.check(ACTIVITY_KINDS);
		await first.apply([MERGE_1], "read");

		const second = new Notices(path, sources(state), () => {});
		state.githubError = "GitHub answered HTTP 502";
		await second.check(ACTIVITY_KINDS);
		state.now = 30 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		expect(await readAfterRestart()).toBe(true);

		state.githubError = undefined;
		state.pullRequests = [];
		state.now = 31 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		state.now = 42 * MINUTE;
		await second.check(ACTIVITY_KINDS);
		expect(await readAfterRestart()).toBe(false);
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

	test("a used-up window is a notice until it resets, kept through a failed omp usage, and a credits run comes and goes on its own", async () => {
		const window = (id: string, exhausted: boolean): PlanWindow => ({ id, label: id, title: id, remaining: exhausted ? 0 : 0.5, resetsAt: 9 * MINUTE, exhausted });
		const cursor = (exhausted: boolean): PlanUsage => ({
			provider: "cursor",
			name: "Cursor",
			account: "me@example.com",
			windows: [window("cursor:usd:individual-auto", false), window("cursor:usd:individual-api", exhausted)],
			extra: null,
			resetCredits: { count: 2, nextExpiresAt: null },
		});
		const run = { provider: "openrouter", model: "openai/gpt-5.5", failures: 3, since: 7 * MINUTE, error: "402 Insufficient credits" };
		const PLAN_ID = "plan:cursor/me@example.com:cursor:usd:individual-api";
		const state: State = { latest: null, installed: "18.8.0", models: [], plans: [cursor(true)], now: 10 * MINUTE };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check(PROVIDER_KINDS);
		expect(notices.list.map(notice => (notice.kind === "plan" ? [notice.id, notice.at, notice.resetCredits] : null))).toEqual([[PLAN_ID, 10 * MINUTE, 2]]);

		state.usageError = "omp usage timed out";
		state.creditRuns = [run];
		await notices.check(PROVIDER_KINDS);
		expect(notices.list.map(({ id, at }) => [id, at])).toEqual([
			[PLAN_ID, 10 * MINUTE],
			["credits:openrouter", 7 * MINUTE],
		]);

		state.usageError = undefined;
		state.plans = [cursor(false)];
		state.creditRuns = [];
		await notices.check(PROVIDER_KINDS);
		expect(notices.list).toEqual([]);
	});

	test("an event is a notice from ten minutes before it starts until it ends, dated then, and Google failing keeps only Google's", async () => {
		const event = (ref: string, start: number): FoundEvent => ({ ref, title: ref, start, end: start + 30 * MINUTE, calendar: null, color: null, url: null });
		const state: State = { latest: null, installed: "18.8.0", models: [], localEvents: [event("local/a", 100 * MINUTE)], googleEvents: [event("google/work/b", 105 * MINUTE)] };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		const ids = () => notices.list.map(({ id, at }) => [id, at]);

		state.now = 89 * MINUTE;
		await notices.check(EVENT_KINDS);
		expect(ids()).toEqual([]);

		state.now = 90 * MINUTE;
		await notices.check(EVENT_KINDS);
		expect(ids()).toEqual([[`event:local/a:${100 * MINUTE}`, 90 * MINUTE]]);

		state.now = 96 * MINUTE;
		await notices.check(EVENT_KINDS);
		expect(ids()).toEqual([
			[`event:google/work/b:${105 * MINUTE}`, 95 * MINUTE],
			[`event:local/a:${100 * MINUTE}`, 90 * MINUTE],
		]);

		state.googleError = "offline";
		state.localEvents = [];
		state.now = 97 * MINUTE;
		await notices.check(EVENT_KINDS);
		expect(ids()).toEqual([[`event:google/work/b:${105 * MINUTE}`, 95 * MINUTE]]);

		state.googleError = undefined;
		state.now = 135 * MINUTE;
		await notices.check(EVENT_KINDS);
		expect(ids()).toEqual([]);
	});

	test("one notice names the sessions that stopped mid-turn, with what their listed files give, and a session that runs again leaves it", async () => {
		const interruptedPath = join(dirname(noticesPath()), "interrupted.json");
		new InterruptedSessions(interruptedPath).setRunning(new Map([["s-busy", true], ["s-also", true], ["s-calm", false]]));
		flushJsonFiles();
		// The server went down, and none of the three outlived it.
		const interrupted = new InterruptedSessions(interruptedPath);
		interrupted.recover(new Set());
		const state: State = { latest: null, installed: "18.8.0", models: [], interrupted, listed: { "s-busy": { title: "Fix the login", cwdDisplay: "~/code/webapp" } }, now: 5 * MINUTE };
		const notices = new Notices(noticesPath(), sources(state), () => {});

		await notices.check(STOPPED_KINDS);
		expect(notices.list).toEqual([
			{
				id: "stopped:s-also,s-busy",
				at: 5 * MINUTE,
				seen: false,
				read: false,
				kind: "stopped",
				sessions: [
					{ sessionId: "s-also", title: null, cwdDisplay: null },
					{ sessionId: "s-busy", title: "Fix the login", cwdDisplay: "~/code/webapp" },
				],
			},
		]);

		interrupted.setRunning(new Map([["s-also", false]]));
		state.now = 6 * MINUTE;
		await notices.check(STOPPED_KINDS);
		expect(notices.list).toEqual([{ id: "stopped:s-busy", at: 6 * MINUTE, seen: false, read: false, kind: "stopped", sessions: [{ sessionId: "s-busy", title: "Fix the login", cwdDisplay: "~/code/webapp" }] }]);

		interrupted.dismiss("s-busy");
		await notices.check(STOPPED_KINDS);
		expect(notices.list).toEqual([]);
	});

	test("a stopped sessions' notice that only loses sessions keeps its marks, across a restart, and one that gains a session is news", async () => {
		const path = noticesPath();
		const interrupted = new InterruptedSessions(join(dirname(path), "interrupted.json"));
		interrupted.recover(new Set());
		interrupted.setRunning(new Map([["s-a", true], ["s-b", true]]));
		interrupted.interrupt("s-a");
		interrupted.interrupt("s-b");
		const state: State = { latest: null, installed: "18.8.0", models: [], interrupted, now: MINUTE };
		const notices = new Notices(path, sources(state), () => {});
		const marks = (of: Notices) => of.list.map(({ id, seen, read }) => ({ id, seen, read }));
		await notices.check(STOPPED_KINDS);
		await notices.apply(["stopped:s-a,s-b"], "seen");
		await notices.apply(["stopped:s-a,s-b"], "read");

		interrupted.setRunning(new Map([["s-a", true]]));
		state.now = 2 * MINUTE;
		await notices.check(STOPPED_KINDS);
		expect(marks(notices)).toEqual([{ id: "stopped:s-b", seen: true, read: true }]);
		const restarted = new Notices(path, sources(state), () => {});
		await restarted.check(STOPPED_KINDS);
		expect(marks(restarted)).toEqual([{ id: "stopped:s-b", seen: true, read: true }]);

		interrupted.setRunning(new Map([["s-a", true], ["s-c", true]]));
		interrupted.interrupt("s-c");
		state.now = 3 * MINUTE;
		await notices.check(STOPPED_KINDS);
		expect(marks(notices)).toEqual([{ id: "stopped:s-b,s-c", seen: false, read: false }]);
	});
});
