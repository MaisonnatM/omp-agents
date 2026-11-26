import { expect, test } from "bun:test";
import { routeFromHash } from "../../routing";
import { applyChange, type BoardChange, type BoardState, emptyBoard } from "../../../templates/omp/agent/extensions/board/log";
import { BOARD_PAGE, type BoardRoute } from "./module";
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
	{ op: "post", by: you, workspace: "/a", title: "Speed up the sidebar", text: "The list stutters on scroll" },
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

test("a Board task that matched on its title shows its title, not its text", () => {
	expect(searchBoard(state, { query: "speed", scope: "workspace" }, "/a", null).map(hit => hit.text)).toEqual(["Speed up the sidebar"]);
	expect(searchBoard(state, { query: "stutters", scope: "workspace" }, "/a", null).map(hit => hit.text)).toEqual(["The list stutters on scroll"]);
});

test("marks merge overlapping words, and a long snippet starts near its first match", () => {
	expect(matchRanges("Redirect loops", ["redir", "direct"])).toEqual([{ start: 0, end: 8 }]);
	const cut = snippet(`${"a ".repeat(200)}**needle** ${"b ".repeat(200)}`, "needle", 100);
	expect(cut.startsWith("…")).toBe(true);
	expect(cut.endsWith("…")).toBe(true);
	expect(cut).toContain("needle");
	expect(cut).not.toContain("**");
});

const parse = (query: string, rest: string | null = null): BoardRoute => {
	const route = routeFromHash(`#board${rest === null ? "" : `/${rest}`}?${query}`);
	if (route.kind !== "page" || route.page.kind !== "board") throw new Error(query);
	const { kind: _, ...board } = route.page;
	return board;
};

test("the Board's address round-trips its search, its scope, and the reply it highlights", () => {
	const route = parse("workspace=%2Fa&q=login+fix&in=thread&reply=2", "1");
	expect(route).toEqual({ workspace: "/a", view: { tab: "messages", thread: 1 }, search: { query: "login fix", scope: "thread" }, reply: 2, bots: false });
	expect(BOARD_PAGE.address.query(route)).toBe("workspace=%2Fa&q=login+fix&in=thread&reply=2");
	expect(BOARD_PAGE.address.query(parse("q=login&in=workspace"))).toBe("q=login");
	expect(parse("q=login&in=all").search).toEqual({ query: "login", scope: "all" });
});

test("the Board's address searches the Workspace for a thread scope without a thread, and drops a reply without one", () => {
	expect(parse("q=login&in=thread").search).toEqual({ query: "login", scope: "workspace" });
	expect(parse("q=login&in=nowhere", "1").search).toEqual({ query: "login", scope: "workspace" });
	expect(parse("reply=2").reply).toBeNull();
	expect(parse("q=+&reply=x", "1")).toEqual({ workspace: null, view: { tab: "messages", thread: 1 }, search: null, reply: null, bots: false });
	expect(parse("q=login", "settings").search).toBeNull();
});
