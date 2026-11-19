import { expect, test } from "bun:test";
import { routeFromHash } from "./routing";
import { memoryHash } from "./components/memory/tabs";
import type { MemoryRoute } from "./components/memory/module";

const repo = (root: string): ProjectMemoryRepo => ({ root, rootDisplay: root, name: root.split("/").pop()!, memories: [] });

test("the Project memory tab shows the repository the address names, else the workspace's, else the first", () => {
	const repos = [repo("/code/a"), repo("/code/ab"), repo("/code/b")];
	expect(shownRepo(repos, "/code/b", "/code/a")?.root).toBe("/code/b");
	expect(shownRepo(repos, "/code/gone", "/code/ab/web")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/code/ab")?.root).toBe("/code/ab");
	expect(shownRepo(repos, null, "/elsewhere")?.root).toBe("/code/a");
	expect(shownRepo([], null, null)).toBeNull();
});

	const routes: [MemoryRoute, string][] = [
		[{ tab: "omp" }, "#memory"],
		[{ tab: "project", repo: null }, "#memory/project"],
		[{ tab: "project", repo: "/Users/me/code/omp agents" }, "#memory/project?repo=%2FUsers%2Fme%2Fcode%2Fomp%20agents"],
	];
	for (const [route, hash] of routes) {
		expect(memoryHash(route)).toBe(hash);
		expect(routeFromHash(hash)).toEqual({ kind: "page", page: { kind: "memory", ...route } });
	}
	expect(routeFromHash("#memory/elsewhere")).toEqual({ kind: "page", page: { kind: "memory", tab: "omp" } });
});
