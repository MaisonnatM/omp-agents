import { describe, expect, test } from "bun:test";
import type { PullRequestState } from "../pull-request-merge";
import { type PullRequest, prKey } from "../shared/github";
import { type CleanupSession, cleanupEnds, MergeCleanup } from "./merge-cleanup";

const pr = (number: number, repo = "r"): PullRequest => ({ owner: "o", repo, number });

function harness() {
	const state = {
		sessions: [] as CleanupSession[],
		/** What GitHub answers for each pull request, by number. */
		github: new Map<number, PullRequestState>(),
		/** The sessions whose end fails. */
		failing: new Set<string>(),
		/** What GitHub's read of the pull requests, and the read of a checkout, wait on before they answer. */
		reading: Promise.resolve(),
		checking: Promise.resolve(),
		log: [] as string[],
	};
	const cleanup = new MergeCleanup({
		sessions: () => state.sessions,
		states: async prs => {
			const answer = new Map(prs.flatMap(one => (state.github.has(one.number) ? [[prKey(one), state.github.get(one.number)!]] : [])));
			await state.reading;
			return answer;
		},
		checkout: async dir => {
			await state.checking;
			return { gitDir: `${dir}/.git`, repo: { owner: "o", repo: "r" } };
		},
		end: async sessionId => {
			if (state.failing.has(sessionId)) throw new Error("omp did not answer");
			state.log.push(`end ${sessionId}`);
			state.sessions = state.sessions.filter(session => session.sessionId !== sessionId);
		},
		deleteBranch: async (gitDir, branch, head) => {
			state.log.push(`delete ${gitDir} ${branch} ${head}`);
			return true;
		},
	});
	/** Two minutes pass, which takes one look. */
	const look = async () => {
		await cleanup.tick();
		await cleanup.tick();
	};
	return { cleanup, state, look };
}

const session = (sessionId: string, numbers: number[], overrides: Partial<CleanupSession> = {}): CleanupSession => ({
	sessionId,
	idle: true,
	pullRequests: numbers.map(number => pr(number)),
	workDir: `/wt/${sessionId}`,
	branch: "feat",
	...overrides,
});

describe("cleanupEnds", () => {
	test("only a session this dashboard started ends: never a terminal session or one another dashboard owns, never a coordinator, a worker by its project's watch, any other by the setting", () => {
		const worker = (watches: boolean) => ({ role: "worker" as const, watches });
		const cases = [
			{ startedHere: false, project: null, cleanUp: true },
			{ startedHere: false, project: worker(true), cleanUp: true },
			{ startedHere: true, project: null, cleanUp: true },
			{ startedHere: true, project: null, cleanUp: false },
			{ startedHere: true, project: worker(true), cleanUp: false },
			{ startedHere: true, project: worker(false), cleanUp: true },
			{ startedHere: true, project: { role: "coordinator" as const, watches: true }, cleanUp: true },
		];
		expect(cases.map(({ cleanUp, ...host }) => cleanupEnds(host, cleanUp))).toEqual([false, false, true, false, true, false, false]);
	});
});

describe("MergeCleanup", () => {
	test("a merge the queue made ends the idle session at once, then deletes its merged branch", async () => {
		const { cleanup, state } = harness();
		state.sessions = [session("s1", [12])];
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		expect(state.log).toEqual(["end s1", "delete /wt/s1/.git feat abc"]);
	});

	test("a merge made elsewhere ends the session at the next look, but one already merged at the first look ends nothing", async () => {
		const { state, look } = harness();
		state.sessions = [session("s1", [12], { branch: "a" }), session("old", [7], { branch: null })];
		state.github.set(12, { state: "open", branch: "a", head: "h1" });
		state.github.set(7, { state: "merged", branch: "b", head: "h0" });
		await look();
		expect(state.log).toEqual([]);
		state.github.set(12, { state: "merged", branch: "a", head: "h2" });
		await look();
		expect(state.log).toEqual(["end s1", "delete /wt/s1/.git a h2"]);
	});

	test("a session waits for its last pull request to merge or close, even when that one was settled before the merge or closes after it", async () => {
		const { cleanup, state, look } = harness();
		state.sessions = [session("before", [12, 13]), session("after", [14, 15])];
		state.github.set(13, { state: "closed", branch: "x", head: "x1" });
		state.github.set(15, { state: "open", branch: "y", head: "y1" });
		await look();
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		await cleanup.merged({ ...pr(14), branch: "feat", head: "def" });
		expect(state.log).toEqual(["end before", "delete /wt/before/.git feat abc"]);
		state.github.set(15, { state: "closed", branch: "y", head: "y1" });
		await look();
		expect(state.log.slice(2)).toEqual(["end after", "delete /wt/after/.git feat def"]);
	});

	test("a session that works when its pull request merges ends once it is idle, and one whose end fails is tried again at the next look", async () => {
		const { cleanup, state, look } = harness();
		state.sessions = [session("busy", [12], { idle: false }), session("stuck", [12])];
		state.failing.add("stuck");
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		expect(state.log).toEqual([]);
		state.sessions = state.sessions.map(one => ({ ...one, idle: true }));
		state.failing.clear();
		await look();
		expect(state.log.toSorted()).toEqual(["delete /wt/busy/.git feat abc", "delete /wt/stuck/.git feat abc", "end busy", "end stuck"]);
	});

	test("a session in a main checkout ends without a branch deleted, a branch of another repository's pull request stays, and one session never ends twice", async () => {
		const { cleanup, state } = harness();
		state.sessions = [session("main", [12], { branch: null }), { ...session("fork", []), pullRequests: [pr(12, "elsewhere")] }];
		await Promise.all([cleanup.merged({ ...pr(12), branch: "feat", head: "abc" }), cleanup.merged({ ...pr(12), branch: "feat", head: "abc" })]);
		await cleanup.merged({ ...pr(12, "elsewhere"), branch: "feat", head: "def" });
		expect(state.log).toEqual(["end main", "end fork"]);
	});

	test("a session that links a pull request only after it merged, such as one resumed later, ends nothing", async () => {
		const { cleanup, state } = harness();
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		state.sessions = [session("s1", [12])];
		await cleanup.merged({ ...pr(13), branch: "feat", head: "abc" });
		expect(state.log).toEqual([]);
	});

	test("a look that read a pull request open before the queue merged it keeps the merge, and deletes the branch at the head the queue merged", async () => {
		const { cleanup, state, look } = harness();
		state.sessions = [session("s1", [12])];
		state.github.set(12, { state: "open", branch: "feat", head: "h1" });
		await look();
		const reading = Promise.withResolvers<void>();
		const checking = Promise.withResolvers<void>();
		state.reading = reading.promise;
		state.checking = checking.promise;
		await cleanup.tick();
		const stale = cleanup.tick();
		const merging = cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		reading.resolve();
		await stale;
		checking.resolve();
		await merging;
		expect(state.log).toEqual(["end s1", "delete /wt/s1/.git feat abc"]);
	});
});
