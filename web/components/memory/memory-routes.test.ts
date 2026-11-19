import { expect, test } from "bun:test";
import { routeFromHash } from "../../routing";
import { memoryHash } from "./tabs";
import type { MemoryRoute } from "./module";

test("memory routes open a repository's project memory and a bookmark search, and round-trip", () => {
	const routes: [MemoryRoute, string][] = [
		[{ tab: "project", repo: null }, "#memory"],
		[{ tab: "project", repo: "/Users/me/code/omp agents" }, "#memory?repo=%2FUsers%2Fme%2Fcode%2Fomp%20agents"],
		[{ tab: "bookmarks", q: "" }, "#memory/bookmarks"],
		[{ tab: "bookmarks", q: "spring & design" }, "#memory/bookmarks?q=spring%20%26%20design"],
	];
	for (const [route, hash] of routes) {
		expect(memoryHash(route)).toBe(hash);
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "memory", ...route } });
	}
	expect(routeFromHash("#memory/project?repo=%2Fr")).toEqual({ kind: "page", page: { kind: "memory", tab: "project", repo: "/r" } });
});
