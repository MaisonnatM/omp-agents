import { describe, expect, test } from "bun:test";
import { hashForPage, type Page, type Route, routeFromHash } from "../../routing";
import type { BoardView } from "./module";
import { boardPageHash } from "./sidebar";

const workspace = "/Users/me/code";
const W = "workspace=%2FUsers%2Fme%2Fcode";
const board = (view: BoardView): Route => ({ kind: "page", page: { kind: "board", workspace, view, search: null, reply: null, session: null } });

describe("Board addresses", () => {
	test("each tab, a thread, and a settings section survive a reload", () => {
		for (const view of [
			{ tab: "messages", thread: null },
			{ tab: "messages", thread: 12 },
			{ tab: "pull-requests", page: { kind: "pull-requests", target: null } },
			{ tab: "memory" },
			{ tab: "settings", section: null },
			{ tab: "routines", routine: { kind: "list" } },
			{ tab: "routines", routine: { kind: "new" } },
			{ tab: "routines", routine: { kind: "open", id: "r1" } },
			{ tab: "routines", routine: { kind: "edit", id: "r1" } },
			{ tab: "settings", section: "worktrees" },
		] satisfies BoardView[]) {
			expect(routeFromHash(hashForPage({ kind: "board", workspace, view, search: null, reply: null, session: null }))).toEqual(board(view));
		}
	});

	test("a project or pull request a Workspace tab opens survives a reload in that tab", () => {
		const pageAt = (hash: string): Page => {
			const route = routeFromHash(hash);
			if (route.kind !== "page") throw new Error(hash);
			return route.page;
		};
		for (const [hash, tab] of [
			["#projects/p1", "projects"],
			["#pull-requests/o/r/5", "pull-requests"],
			["#pull-requests/o/r/5/files/src/a.ts", "pull-requests"],
		] as const) {
			const page = pageAt(hash);
			const link = boardPageHash(workspace)(page);
			expect(link).toBe(`#board/${hashForPage(page).slice(1)}?${W}`);
			expect(routeFromHash(link)).toEqual(board({ tab, page } as BoardView));
		}
		expect(boardPageHash(workspace)({ kind: "notifications" })).toBe("#notifications");
	});

	test("a thread number is never read as a tab, and a section only belongs to Settings", () => {
		expect(hashForPage({ kind: "board", workspace, view: { tab: "settings", section: "files" }, search: null, reply: null, session: null })).toBe(`#board/settings/files?${W}`);
		expect(routeFromHash(`#board/7?${W}`)).toEqual(board({ tab: "messages", thread: 7 }));
		expect(routeFromHash(`#board/memory/files?${W}`)).toEqual(board({ tab: "memory" }));
		expect(routeFromHash(`#board/nope?${W}`)).toEqual(board({ tab: "messages", thread: null }));
	});

	test("a thread opened on a session keeps that session across a reload, and a session without a thread is dropped", () => {
		const route = routeFromHash(`#board/7?${W}&session=s2`);
		expect(route).toEqual({ kind: "page", page: { kind: "board", workspace, view: { tab: "messages", thread: 7 }, search: null, reply: null, session: "s2" } });
		if (route.kind !== "page") throw new Error("no page");
		expect(routeFromHash(hashForPage(route.page))).toEqual(route);
		expect(routeFromHash(`#board?${W}&session=s2`)).toEqual(board({ tab: "messages", thread: null }));
	});
});
