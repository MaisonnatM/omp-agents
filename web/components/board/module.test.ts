import { describe, expect, test } from "bun:test";
import { hashForPage, routeFromHash } from "../../routing";

const W = "workspace=%2FUsers%2Fme%2Fcode";

describe("Board addresses", () => {
	test("each tab, a thread, and a settings section survive a reload", () => {
		for (const page of [
			{ kind: "board", workspace: "/Users/me/code", tab: "messages", thread: null },
			{ kind: "board", workspace: "/Users/me/code", tab: "messages", thread: 12 },
			{ kind: "board", workspace: "/Users/me/code", tab: "pull-requests", thread: null },
			{ kind: "board", workspace: "/Users/me/code", tab: "settings", thread: null },
			{ kind: "board", workspace: "/Users/me/code", tab: "settings", thread: null, section: "worktrees" },
		] as const) {
			expect(routeFromHash(hashForPage(page))).toEqual({ kind: "page", page });
		}
	});

	test("a thread number is never read as a tab, and a section only belongs to Settings", () => {
		expect(hashForPage({ kind: "board", workspace: "/Users/me/code", tab: "settings", thread: null, section: "files" })).toBe(`#board/settings/files?${W}`);
		expect(routeFromHash(`#board/7?${W}`)).toEqual({ kind: "page", page: { kind: "board", workspace: "/Users/me/code", tab: "messages", thread: 7 } });
		expect(routeFromHash(`#board/memory/files?${W}`)).toEqual({ kind: "page", page: { kind: "board", workspace: "/Users/me/code", tab: "memory", thread: null } });
		expect(routeFromHash(`#board/nope?${W}`)).toEqual({ kind: "page", page: { kind: "board", workspace: "/Users/me/code", tab: "messages", thread: null } });
	});
});
