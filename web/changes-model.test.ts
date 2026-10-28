import { describe, expect, test } from "bun:test";
import type { ChangedEntry, DiffRow } from "../src/shared/changes";
import { changeBlocks, changesPathOf, type DiffItem, fileLines, fileTree, foldDiff, foldersAbove, lastAtOrAbove, shortPaths, treeOrder, withMember } from "./changes-model";

const same = (count: number, from = 1): DiffRow[] => Array.from({ length: count }, (_, at) => ({ sign: " ", old: from + at, new: from + at, text: "" }));
const added: DiffRow = { sign: "+", old: null, new: 0, text: "" };
const removed: DiffRow = { sign: "-", old: 0, new: null, text: "" };
const entry = (path: string): ChangedEntry => ({ path, status: "modified", added: 1, removed: 0, session: false });
const shown = (items: DiffItem[]) => items.map(item => (item.kind === "row" ? item.index : `fold ${item.from}-${item.to}`));

describe("shortPaths", () => {
	test("names a file alone, and adds the fewest folders that tell two of one name apart", () => {
		expect(shortPaths(["web/app.tsx", "src/app.tsx", "README.md", "x/web/a.ts", "y/web/a.ts", "app.tsx", "docs/README.txt"])).toEqual([
			{ name: "app.tsx", dir: "web/" },
			{ name: "app.tsx", dir: "src/" },
			{ name: "README.md", dir: "" },
			{ name: "a.ts", dir: "x/web/" },
			{ name: "a.ts", dir: "y/web/" },
			{ name: "app.tsx", dir: "" },
			{ name: "README.txt", dir: "" },
		]);
	});
});

describe("lastAtOrAbove", () => {
	const tops = [0, 100, 100, 250, 900];
	const find = (y: number) => lastAtOrAbove(tops.length, at => tops[at]!, y);
	test("names the item whose top is the last at or above the line, the later of two sharing a top", () => {
		expect([find(0), find(99), find(100), find(249), find(250), find(5000)]).toEqual([0, 0, 2, 2, 3, 4]);
	});
	test("falls back to the first item above them all, and to 0 with none", () => {
		expect(find(-10)).toBe(0);
		expect(lastAtOrAbove(0, () => 0, 50)).toBe(0);
	});
});

describe("foldDiff", () => {
	test("keeps three lines around a change and none at the file's ends", () => {
		const rows = [...same(10), added, ...same(10)];
		expect(shown(foldDiff(rows, new Set()))).toEqual(["fold 0-7", 7, 8, 9, 10, 11, 12, 13, "fold 14-21"]);
	});

	test("a run between two changes keeps three lines on each side, and folds only more than two lines", () => {
		expect(shown(foldDiff([added, ...same(9), added], new Set()))).toEqual([0, 1, 2, 3, "fold 4-7", 7, 8, 9, 10]);
		expect(shown(foldDiff([added, ...same(8), added], new Set()))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	test("an opened run shows whole, by the index its run starts at", () => {
		const rows = [added, ...same(10)];
		expect(shown(foldDiff(rows, new Set([1])))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	test("a file with no change shows whole", () => {
		expect(shown(foldDiff(same(20), new Set()))).toEqual(Array.from({ length: 20 }, (_, index) => index));
	});
});

describe("changeBlocks", () => {
	test("keeps each unchanged row alone and groups a change's removed and added rows, starting at its first row", () => {
		expect(changeBlocks([...same(1), removed, removed, added, ...same(1), added, removed])).toEqual([
			{ kind: "same", start: 0 },
			{ kind: "change", start: 1, removed: [1, 2], added: [3] },
			{ kind: "same", start: 4 },
			{ kind: "change", start: 5, removed: [6], added: [5] },
		]);
		expect(changeBlocks([])).toEqual([]);
	});
});

describe("withMember", () => {
	test("adds or drops the path, and gives the same set back when nothing changes", () => {
		const set: ReadonlySet<string> = new Set(["a.ts"]);
		expect([...withMember(set, "b.ts", true)]).toEqual(["a.ts", "b.ts"]);
		expect([...withMember(set, "a.ts", false)]).toEqual([]);
		expect(withMember(set, "a.ts", true)).toBe(set);
		expect(withMember(set, "b.ts", false)).toBe(set);
		expect([...set]).toEqual(["a.ts"]);
	});
});

describe("fileLines", () => {
	test("marks added runs, runs that replaced removed lines, and removed lines at the end", () => {
		const { lines, removedAtEnd } = fileLines([...same(1), removed, added, added, ...same(1), added, ...same(1), removed, removed]);
		expect(lines.map(line => [line.index, line.mark, line.removed, line.run])).toEqual([
			[0, null, [], 0],
			// Every line of a run peeks at the rows it replaced, shown above the run's first line.
			[2, "modified", [1], 2],
			[3, "modified", [1], 2],
			[4, null, [], 4],
			[5, "added", [], 5],
			[6, null, [], 6],
		]);
		expect(removedAtEnd).toEqual([7, 8]);
	});

	test("removed lines before an unchanged line hang on it unmarked", () => {
		expect(fileLines([removed, ...same(1)]).lines).toEqual([{ index: 1, mark: null, removed: [0], run: 1 }]);
	});
});

describe("fileTree", () => {
	test("joins chains of single folders, lists folders before files, and orders ↓ and ↑ by the tree", () => {
		const tree = fileTree([entry("README.md"), entry("web/components/changes/a.tsx"), entry("web/components/changes/b.tsx"), entry("src/z.ts"), entry("src/server/a.ts")]);
		expect(tree.dirs.map(dir => dir.name)).toEqual(["src", "web/components/changes"]);
		expect(tree.dirs[1]!.path).toBe("web/components/changes");
		expect(treeOrder(tree).map(file => file.path)).toEqual(["src/server/a.ts", "src/z.ts", "web/components/changes/a.tsx", "web/components/changes/b.tsx", "README.md"]);
		// ↓ or ↑ opening a file reopens the folders above it, a joined chain by its full path.
		expect(foldersAbove(tree, "src/server/a.ts")).toEqual(["src", "src/server"]);
		expect(foldersAbove(tree, "web/components/changes/b.tsx")).toEqual(["web/components/changes"]);
		expect(foldersAbove(tree, "README.md")).toEqual([]);
	});

	test("an absolute path hangs under one `/` folder, joined with its single folders", () => {
		const tree = fileTree([entry("/tmp/x/notes.md"), entry("a.ts")]);
		expect(tree.dirs.map(dir => dir.name)).toEqual(["/tmp/x"]);
		expect(treeOrder(tree).map(file => file.path)).toEqual(["/tmp/x/notes.md", "a.ts"]);
	});
});
describe("changesPathOf", () => {
	const files = [entry("web/app.tsx"), entry("~/notes/plan.md"), entry("app.tsx")];
	test("finds the Todos card's path in the changes list, from a subdirectory, outside the checkout, or by its tail under ~", () => {
		expect(changesPathOf("app.tsx", "/repo/web", "/repo", files)).toBe("web/app.tsx");
		expect(changesPathOf("app.tsx", "/repo", "/repo", files)).toBe("app.tsx");
		expect(changesPathOf("~/notes/plan.md", "/repo", "/repo", files)).toBe("~/notes/plan.md");
		expect(changesPathOf("~/code/wt/web/app.tsx", "/repo", "/Users/me/code/wt", files)).toBe("web/app.tsx");
		expect(changesPathOf("gone.ts", "/repo", "/repo", files)).toBeNull();
		expect(changesPathOf("web/app.tsx", "/elsewhere", null, files)).toBe("web/app.tsx");
	});
});
