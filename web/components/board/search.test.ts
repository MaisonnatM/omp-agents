import { expect, test } from "bun:test";
import { applyChange, type BoardChange, type BoardState, emptyBoard } from "../../../templates/omp/agent/extensions/board/log";
import { matchRanges, searchBoard, snippet } from "./search";

function board(...changes: BoardChange[]): BoardState {
	let state = emptyBoard();
	changes.forEach((change, index) => {
		const applied = applyChange(state, change, 1_000 + index);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
	});
	return state;
}

const you = { kind: "user" } as const;
const state = board(
	{ op: "post", by: you, workspace: "/a", title: "Fix the login redirect", labels: { area: "auth" } },
	{ op: "post", by: you, workspace: "/b", title: "Login page copy" },
	{ op: "reply", by: you, task: 1, text: "The redirect loops on Safari" },
	{ op: "post", by: you, workspace: "/a", title: "Speed up the sidebar" },
);

const found = (query: string, scope: "thread" | "workspace" | "all", thread: number | null = null) => searchBoard(state, { query, scope }, "/a", thread).map(hit => [hit.task.id, hit.reply]);

test("every word must match, in any case, across a Board task's title, text, and labels", () => {
	expect(found("LOGIN fix", "workspace")).toEqual([[1, null]]);
	expect(found("auth redirect", "workspace")).toEqual([[1, null]]);
	expect(found("login sidebar", "workspace")).toEqual([]);
});

test("replies match on their own, newest first, and each scope narrows the Board tasks", () => {
	expect(found("redirect", "workspace")).toEqual([
		[1, 0],
		[1, null],
	]);
	expect(found("login", "all")).toEqual([
		[2, null],
		[1, null],
	]);
	expect(found("safari", "thread", 1)).toEqual([[1, 0]]);
	expect(found("sidebar", "thread", 1)).toEqual([]);
});

test("marks merge overlapping words, and a long snippet starts near its first match", () => {
	expect(matchRanges("Redirect loops", ["redir", "direct"])).toEqual([{ start: 0, end: 8 }]);
	const text = `${"a ".repeat(200)}needle ${"b ".repeat(200)}`;
	const cut = snippet(text, ["needle"], 100);
	expect(cut.startsWith("…") && cut.endsWith("…") && cut.includes("needle")).toBe(true);
});
