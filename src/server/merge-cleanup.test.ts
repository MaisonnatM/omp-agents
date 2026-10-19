import { describe, expect, test } from "bun:test";
import type { PullRequestState } from "../pull-request-merge";
import { type PullRequest, prKey } from "../shared/github";
import { type CleanupSession, finishedSessions, MergeCleanup } from "./merge-cleanup";

const pr = (number: number): PullRequest => ({ owner: "o", repo: "r", number });

describe("finishedSessions", () => {
	const settledOnes = new Set([12, 13]);
	const settled = (one: PullRequest): boolean => settledOnes.has(one.number);
	const session = (sessionId: string, idle: boolean, numbers: number[]) => ({ sessionId, idle, pullRequests: numbers.map(pr) });

	test("a merge finishes the idle sessions linked to it whose every pull request is merged or closed", () => {
		const sessions = [session("done", true, [12, 13]), session("busy", false, [12]), session("open", true, [12, 14]), session("other", true, [13])];
		expect(finishedSessions(sessions, [pr(12)], settled).map(found => found.sessionId)).toEqual(["done"]);
		expect(finishedSessions(sessions, [pr(13)], settled).map(found => found.sessionId)).toEqual(["done", "other"]);
		expect(finishedSessions(sessions, [], settled)).toEqual([]);
	});
});

function harness() {
	const state = {
		enabled: true,
		sessions: [] as CleanupSession[],
		/** What GitHub answers for each pull request, by number. */
		github: new Map<number, PullRequestState>(),
		log: [] as string[],
	};
	const cleanup = new MergeCleanup({
		enabled: () => state.enabled,
		sessions: () => state.sessions,
		states: async prs => new Map(prs.flatMap(one => (state.github.has(one.number) ? [[prKey(one), state.github.get(one.number)!]] : []))),
		gitDir: async dir => `${dir}/.git`,
		end: async sessionId => void state.log.push(`end ${sessionId}`),
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

describe("MergeCleanup", () => {
	test("a merge the dashboard made ends the idle session at once, then deletes its merged branch", async () => {
		const { cleanup, state } = harness();
		state.sessions = [{ sessionId: "s1", idle: true, pullRequests: [pr(12)], workDir: "/wt/feat", branch: "feat" }];
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		expect(state.log).toEqual(["end s1", "delete /wt/feat/.git feat abc"]);
	});

	test("a merge made elsewhere ends the session at the next look, but one already merged at the first look ends nothing", async () => {
		const { state, look } = harness();
		state.sessions = [
			{ sessionId: "s1", idle: true, pullRequests: [pr(12)], workDir: "/wt/a", branch: "a" },
			{ sessionId: "old", idle: true, pullRequests: [pr(7)], workDir: "/repo", branch: null },
		];
		state.github.set(12, { state: "open", branch: "a", head: "h1" });
		state.github.set(7, { state: "merged", branch: "b", head: "h0" });
		await look();
		expect(state.log).toEqual([]);
		state.github.set(12, { state: "merged", branch: "a", head: "h2" });
		await look();
		expect(state.log).toEqual(["end s1", "delete /wt/a/.git a h2"]);
	});

	test("with the setting off, a merge ends nothing", async () => {
		const { cleanup, state } = harness();
		state.enabled = false;
		state.sessions = [{ sessionId: "s1", idle: true, pullRequests: [pr(12)], workDir: "/wt/feat", branch: "feat" }];
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		expect(state.log).toEqual([]);
		state.enabled = true;
		await cleanup.merged({ ...pr(12), branch: "feat", head: "abc" });
		expect(state.log).toEqual(["end s1", "delete /wt/feat/.git feat abc"]);
	});

	test("a session in a main checkout ends without a branch deleted, and one session never ends twice", async () => {
		const { cleanup, state } = harness();
		state.sessions = [{ sessionId: "s1", idle: true, pullRequests: [pr(12)], workDir: "/repo", branch: null }];
		await Promise.all([cleanup.merged({ ...pr(12), branch: "feat", head: "abc" }), cleanup.merged({ ...pr(12), branch: "feat", head: "abc" })]);
		expect(state.log).toEqual(["end s1"]);
	});
});
