import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MergeStatus } from "../pull-request-merge";
import { type PullRequest, prKey } from "../shared/github";
import type { QueuedMerge, QueuedPullRequest } from "../shared/merge-queue";
import { type MergeGitHub, MergeQueue, nextStep, stackOrder } from "./merge-queue";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mergesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-merges-"));
	dirs.push(dir);
	return join(dir, "merges.json");
}

const T0 = 1_000_000;

function status(overrides: Partial<MergeStatus> = {}): MergeStatus {
	return { id: "N12", state: "open", draft: false, branch: "feat", head: "h1", base: "main", title: "Feat", mergeState: "clean", checks: "passing", parents: [], autoArmed: false, autoAllowed: false, ...overrides };
}

const queued = (overrides: Partial<QueuedMerge> = {}): QueuedMerge => ({
	id: "m1",
	method: "squash",
	base: "main",
	prs: [{ owner: "o", repo: "r", number: 12, title: "Feat", branch: "feat", head: "h1" }],
	merged: 0,
	auto: false,
	updatedAt: null,
	state: { kind: "waiting", why: "Queued" },
	...overrides,
});

describe("nextStep", () => {
	test("a pull request ready now merges; a behind one updates its branch; pending checks wait or arm auto-merge", () => {
		expect(nextStep(queued(), status(), T0)).toEqual({ kind: "merge" });
		expect(nextStep(queued(), status({ mergeState: "behind" }), T0)).toEqual({ kind: "update" });
		expect(nextStep(queued({ updatedAt: T0 - 5_000 }), status({ mergeState: "behind" }), T0)).toEqual({ kind: "wait", why: "Updating the branch" });
		expect(nextStep(queued({ updatedAt: T0 - 120_000 }), status({ mergeState: "behind" }), T0)).toEqual({ kind: "update" });
		expect(nextStep(queued(), status({ mergeState: "blocked", checks: "pending" }), T0)).toEqual({ kind: "wait", why: "Waiting for checks" });
		expect(nextStep(queued(), status({ mergeState: "clean", checks: "pending" }), T0)).toEqual({ kind: "wait", why: "Waiting for checks" });
		expect(nextStep(queued(), status({ mergeState: "blocked", checks: "pending", autoAllowed: true }), T0)).toEqual({ kind: "arm" });
		expect(nextStep(queued(), status({ mergeState: "blocked", checks: "pending", autoArmed: true }), T0)).toEqual({ kind: "wait", why: "GitHub merges it once it is ready" });
	});

	test("a stack's next pull request is retargeted and marked ready before it merges", () => {
		expect(nextStep(queued(), status({ base: "feat-lower" }), T0)).toEqual({ kind: "retarget" });
		expect(nextStep(queued(), status({ draft: true, mergeState: "draft" }), T0)).toEqual({ kind: "ready" });
	});

	test("it stops on a close, a moved branch, conflicts, and failing checks, with the reason", () => {
		expect(nextStep(queued(), status({ state: "merged" }), T0)).toEqual({ kind: "merged" });
		expect(nextStep(queued(), status({ state: "closed" }), T0)).toEqual({ kind: "fail", why: "#12 was closed." });
		expect(nextStep(queued({ updatedAt: T0 }), status({ head: "h2", parents: ["h1", "b1"] }), T0)).toEqual({ kind: "adopt" });
		expect(nextStep(queued({ updatedAt: T0 }), status({ head: "h2", parents: ["h1"] }), T0)).toMatchObject({ kind: "fail" });
		expect(nextStep(queued({ updatedAt: T0 }), status({ head: "h2", parents: ["x9", "h1"] }), T0)).toMatchObject({ kind: "fail" });
		expect(nextStep(queued(), status({ head: "h2", parents: ["h1", "b1"] }), T0)).toMatchObject({ kind: "fail" });
		expect(nextStep(queued(), status({ head: "h9" }), T0)).toEqual({ kind: "fail", why: "#12's branch moved after the merge was queued; review it and merge again." });
		expect(nextStep(queued(), status({ mergeState: "dirty" }), T0)).toEqual({ kind: "fail", why: "#12 conflicts with main." });
		expect(nextStep(queued(), status({ checks: "failing", mergeState: "unstable" }), T0)).toEqual({ kind: "fail", why: "#12's checks failed." });
	});
});

describe("stackOrder", () => {
	test("orders a stack bottom first, whatever order it came in, and refuses pull requests that are no one chain, such as one of another repository", () => {
		const top = { owner: "o", repo: "r", number: 3, name: "top", branch: "c", base: "b" };
		const middle = { owner: "o", repo: "r", number: 2, name: "middle", branch: "b", base: "a" };
		const bottom = { owner: "o", repo: "r", number: 1, name: "bottom", branch: "a", base: "main" };
		expect(stackOrder([top, bottom, middle])?.map(pr => pr.name)).toEqual(["bottom", "middle", "top"]);
		expect(stackOrder([bottom])?.map(pr => pr.name)).toEqual(["bottom"]);
		expect(stackOrder([top, bottom])).toBeNull();
		expect(stackOrder([bottom, { ...bottom, number: 4, name: "sibling", branch: "d" }])).toBeNull();
		expect(stackOrder([bottom, { ...middle, repo: "elsewhere" }])).toBeNull();
	});
});

/** A GitHub of pull requests by number that answers the queue's reads and takes its steps, logging each. */
function fakeGitHub(statuses: Map<number, MergeStatus>) {
	const log: string[] = [];
	const byId = (id: string): MergeStatus => [...statuses.values()].find(one => one.id === id)!;
	const github: MergeGitHub = {
		status: async (pr: PullRequest) => ({ ...statuses.get(pr.number)! }),
		merge: async (id, method, head) => {
			const pr = byId(id);
			log.push(`merge ${id} ${method} ${head}`);
			if (pr.mergeState === "dirty") throw new Error("Merge conflict");
			pr.state = "merged";
		},
		update: async (id, head) => {
			log.push(`update ${id} ${head}`);
			const pr = byId(id);
			Object.assign(pr, { head: `${head}+`, parents: [head, "base1"], mergeState: "clean" });
		},
		arm: async id => void log.push(`arm ${id}`),
		disarm: async id => void log.push(`disarm ${id}`),
		retarget: async (id, base) => {
			log.push(`retarget ${id} ${base}`);
			Object.assign(byId(id), { base, mergeState: "behind" });
		},
		ready: async id => {
			log.push(`ready ${id}`);
			byId(id).draft = false;
		},
	};
	return { github, log };
}

function queue(statuses: Map<number, MergeStatus>, { now = () => T0, active = (): boolean => true, path = mergesPath() } = {}) {
	const { github, log } = fakeGitHub(statuses);
	const merged: QueuedPullRequest[] = [];
	let ids = 0;
	const merges = new MergeQueue({ path, github, now, newId: () => `m${++ids}`, active, onChange: () => {}, onMerged: pr => void merged.push(pr) });
	return { merges, log, merged, path };
}

describe("MergeQueue", () => {
	test("a 2-pull-request stack merges bottom first, then retargets the top onto the base, marks it ready, updates its branch, and merges it", async () => {
		const statuses = new Map([
			[1, status({ id: "N1", branch: "lower", head: "l1", base: "main" })],
			[2, status({ id: "N2", branch: "upper", head: "u1", base: "lower", draft: true, mergeState: "draft" })],
		]);
		const { merges, log, merged } = queue(statuses);
		const answered = await merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 2, head: null }, { owner: "o", repo: "r", number: 1, head: "l1" }] });
		expect(answered.map(prKey)).toEqual(["o/r#1"]);
		expect(log).toEqual(["merge N1 squash l1", "retarget N2 main", "ready N2", "update N2 u1"]);
		expect(merges.list).toMatchObject([{ base: "main", merged: 1, prs: [{ number: 2, head: "u1" }], updatedAt: T0, state: { kind: "waiting", why: "Updating the branch" } }]);
		await merges.tick();
		expect(log.slice(4)).toEqual(["merge N2 squash u1+"]);
		expect(merged.map(prKey)).toEqual(["o/r#1", "o/r#2"]);
		expect(merges.list).toEqual([]);
	});

	test("a stack stops at its first failure with the reason, and leaves the pull requests above it unmerged until cancelled", async () => {
		const statuses = new Map([
			[1, status({ id: "N1", branch: "lower", head: "l1", base: "main", mergeState: "dirty" })],
			[2, status({ id: "N2", branch: "upper", head: "u1", base: "lower" })],
		]);
		const { merges, log, merged } = queue(statuses);
		await merges.apply({ op: "add", method: "merge", prs: [{ owner: "o", repo: "r", number: 1, head: null }, { owner: "o", repo: "r", number: 2, head: null }] });
		expect(log).toEqual([]);
		expect(merged).toEqual([]);
		expect(merges.list).toMatchObject([{ merged: 0, prs: [{ number: 1 }, { number: 2 }], state: { kind: "failed", why: "#1 conflicts with main." } }]);
		await merges.tick();
		expect(log).toEqual([]);
		await merges.apply({ op: "cancel", id: "m1" });
		expect(merges.list).toEqual([]);
	});

	test("a queue refuses a pull request whose branch moved since the confirmation, and one already queued", async () => {
		const statuses = new Map([[12, status({ mergeState: "blocked", checks: "pending" })]]);
		const { merges } = queue(statuses);
		await expect(merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 12, head: "h0" }] })).rejects.toThrow("o/r#12's branch moved since you looked; review it and merge again.");
		await merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 12, head: "h1" }] });
		expect(merges.list).toMatchObject([{ state: { kind: "waiting", why: "Waiting for checks" } }]);
		await expect(merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 12, head: "h1" }] })).rejects.toThrow("o/r#12 is already queued to merge.");
	});

	test("only the server that holds the owner lock changes GitHub: it steps a merge another server queued at its next tick, and stops one that server cancelled", async () => {
		const statuses = new Map([
			[12, status({ id: "N12", head: "h1" })],
			[13, status({ id: "N13", branch: "other", head: "o1", mergeState: "blocked", checks: "pending" })],
		]);
		const owner = queue(statuses);
		const other = queue(statuses, { active: () => false, path: owner.path });
		expect(await other.merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 12, head: "h1" }] })).toEqual([]);
		expect(other.log).toEqual([]);
		expect(other.merges.list).toMatchObject([{ prs: [{ number: 12 }], state: { kind: "waiting", why: "Queued" } }]);
		await owner.merges.tick();
		expect(owner.log).toEqual(["merge N12 squash h1"]);
		expect(owner.merged.map(prKey)).toEqual(["o/r#12"]);
		await other.merges.tick();
		expect(other.merges.list).toEqual([]);

		await owner.merges.apply({ op: "add", method: "squash", prs: [{ owner: "o", repo: "r", number: 13, head: "o1" }] });
		const [waiting] = owner.merges.list;
		await other.merges.tick();
		await other.merges.apply({ op: "cancel", id: waiting!.id });
		statuses.get(13)!.checks = "passing";
		statuses.get(13)!.mergeState = "clean";
		await owner.merges.tick();
		expect(owner.log).toEqual(["merge N12 squash h1"]);
		expect(owner.merges.list).toEqual([]);
	});
});
