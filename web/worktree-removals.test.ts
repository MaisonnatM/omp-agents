import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ReactNode } from "react";
import type { WorktreeBlocker, WorktreeRemovalRequest, WorktreeRemovalResult } from "../src/worktrees-shared";
import { toasts } from "./components/toaster";
import { type RemovalTarget, removeWorktrees } from "./worktree-removals";

const target = (branch: string): RemovalTarget => ({ repository: "/code/app", path: `/code/app-wt/${branch}`, branch });

const busy: WorktreeBlocker = { code: "occupied", message: "A live session uses this checkout." };

/** What the server previews for each branch; a branch missing here previews as removable. */
let previews: Record<string, { blockers?: WorktreeBlocker[]; detachedCommitLoss?: boolean }>;
/** What the server answers when asked to remove each branch; a branch missing here is removed. */
let removals: Record<string, Partial<WorktreeRemovalResult> | Error>;
let requested: WorktreeRemovalRequest[];

const branchOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const reply = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

interface Shown {
	type?: string;
	title?: ReactNode;
	description?: ReactNode;
}

let shown: Map<string, Shown>;
/** What each toast said, by id, every time it changed. */
let said: Map<string, string[]>;

function show(id: string, change: Shown): void {
	const toast = { ...shown.get(id), ...change };
	shown.set(id, toast);
	const words = [toast.title, toast.description].filter(Boolean).join(": ");
	const before = said.get(id) ?? [];
	if (before.at(-1) !== words) said.set(id, [...before, words]);
}

beforeEach(() => {
	previews = {};
	removals = {};
	requested = [];
	shown = new Map();
	said = new Map();
	let ids = 0;
	spyOn(globalThis, "fetch").mockImplementation((async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as WorktreeRemovalRequest;
		requested.push(body);
		if (body.action === "preview") {
			return reply({
				plans: body.targets.map(({ repository, path }) => ({ repository, path, blockers: [], kind: "remove", branch: branchOf(path), head: "abc", ignored: ["node_modules"], detachedCommitLoss: false, savedSessionIds: [], confirmation: `ok-${branchOf(path)}`, ...previews[branchOf(path)] })),
			});
		}
		const results = body.plans.map(({ repository, path }) => {
			const answer = removals[branchOf(path)];
			if (answer instanceof Error) throw answer;
			return { repository, path, removed: true, blockers: [], error: null, ...answer };
		});
		return reply({ results });
	}) as typeof fetch);
	spyOn(toasts, "add").mockImplementation(({ id = `toast-${(ids += 1)}`, type, title, description }) => {
		show(id, { type, title, description });
		return id;
	});
	spyOn(toasts, "update").mockImplementation((id, change) => {
		if (typeof change !== "function") show(id, { title: change.title, description: change.description });
	});
});

afterEach(() => mock.restore());

const removed = (): string[] => requested.flatMap(request => (request.action === "remove" ? request.plans.map(plan => branchOf(plan.path)) : []));

describe("removeWorktrees", () => {
	test("counts a run of several in one toast, one worktree at a time, then sums it up", async () => {
		await removeWorktrees([target("a"), target("b"), target("c")], false);
		expect(requested.map(request => request.action)).toEqual(["preview", "remove", "remove", "remove"]);
		expect([...said.values()]).toEqual([
			[
				"Removing 3 worktrees: Checking whether they can be removed",
				"Removing 1 of 3 worktrees: a",
				"Removing 2 of 3 worktrees: b",
				"Removing 3 of 3 worktrees: c",
				"Removed 3 of 3 worktrees: Branches and session transcripts stay.",
			],
		]);
	});

	test("turns a single removal's toast into how it ended", async () => {
		previews = { a: { detachedCommitLoss: true } };
		await removeWorktrees([target("a")], false);
		expect(removed()).toEqual([]);
		expect([...said.values()]).toEqual([["Removing a: Checking whether it can be removed", "Removing a", "Kept a: Its detached commit is on no branch, tag, or remote, so removing it could lose that commit. Put a branch on it or push it, then delete it again."]]);
	});

	test("toasts a hand-picked worktree it keeps and one that fails, and counts both", async () => {
		previews = { b: { blockers: [busy] } };
		removals = { c: { removed: false, error: "Permission denied" } };
		await removeWorktrees([target("a"), target("b"), target("c")], false);
		expect(removed()).toEqual(["a", "c"]);
		expect([...said.values()].map(words => words.at(-1))).toEqual(["Removed 1 of 3 worktrees: 1 kept and 1 failed. Branches and session transcripts stay.", "Kept b: A live session uses this checkout.", "Could not remove c: Permission denied"]);
	});

	test("counts without a toast of its own each merged worktree it keeps, but toasts a failed request", async () => {
		previews = { b: { blockers: [{ code: "unmerged", message: "Its work is not merged." }] } };
		removals = { c: new Error("socket closed") };
		await removeWorktrees([target("a"), target("b"), target("c")], true);
		expect(requested[0]).toMatchObject({ action: "preview", merged: true });
		expect([...said.values()].map(words => words.at(-1))).toEqual(["Removed 1 of 3 worktrees: 1 kept and 1 failed. Branches and session transcripts stay.", "Could not remove c: socket closed"]);
	});

	test("a second run waits for the first, and a worktree already queued keeps its place", async () => {
		const first = removeWorktrees([target("a"), target("b")], false);
		const second = removeWorktrees([target("b"), target("c")], false);
		await Promise.all([first, second]);
		expect(removed()).toEqual(["a", "b", "c"]);
		expect([...said.values()]).toEqual([
			["Removing 2 worktrees: Checking whether they can be removed", "Removing 1 of 2 worktrees: a", "Removing 2 of 2 worktrees: b", "Removed 2 of 2 worktrees: Branches and session transcripts stay."],
			["Removing c: Waiting for another removal", "Removing c: Checking whether it can be removed", "Removing c", "Removed c: Its branch and session transcripts stay."],
		]);
	});
});
