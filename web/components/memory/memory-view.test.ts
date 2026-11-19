import { expect, test } from "bun:test";
import type { ProjectMemoryRepo } from "../../../src/shared/memory-page";
import { routeFromHash } from "../../routing";
import { shownRepo } from "./memory-view";
import { memoryHash } from "./tabs";
import type { MemoryRoute } from "./module";

const repo = (root: string): ProjectMemoryRepo => ({ root, rootDisplay: root, name: root.split("/").pop()!, memories: [] });

test("the Project memory tab shows the repository the address names, else the workspace's, else the first", () => {
	const repos = [repo("/code/a"), repo("/code/ab"), repo("/code/b")];
	expect(shownRepo(repos, "/code/b", "/code/a")?.root).toBe("/code/b");
	expect(shownRepo(repos, "/code/gone", "/code/ab/web")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/code/ab")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/elsewhere")?.root).toBe("/code/a");
	expect(shownRepo([], null, null)).toBeNull();
});

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
