import { describe, expect, test } from "bun:test";
import { hashForPage, type Route, routeFromHash } from "../../routing";
import type { BoardView } from "./module";

const workspace = "/Users/me/code";
const W = "workspace=%2FUsers%2Fme%2Fcode";
const board = (view: BoardView): Route => ({ kind: "page", page: { kind: "board", workspace, view, search: null, reply: null } });

describe("Board addresses", () => {
	test("each tab, a thread, and a settings section survive a reload", () => {
		for (const view of [
			{ tab: "messages", thread: null },
			{ tab: "messages", thread: 12 },
			{ tab: "pull-requests" },
			{ tab: "settings", section: null },
			{ tab: "settings", section: "worktrees" },
		] as const) {
			expect(routeFromHash(hashForPage({ kind: "board", workspace, view, search: null, reply: null }))).toEqual(board(view));
		}
	});

	test("a thread number is never read as a tab, and a section only belongs to Settings", () => {
		expect(hashForPage({ kind: "board", workspace, view: { tab: "settings", section: "files" }, search: null, reply: null })).toBe(`#board/settings/files?${W}`);
		expect(routeFromHash(`#board/7?${W}`)).toEqual(board({ tab: "messages", thread: 7 }));
		expect(routeFromHash(`#board/memory/files?${W}`)).toEqual(board({ tab: "memory" }));
		expect(routeFromHash(`#board/nope?${W}`)).toEqual(board({ tab: "messages", thread: null }));
	});
});
