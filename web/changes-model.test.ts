import { describe, expect, test } from "bun:test";
import type { ChangedEntry, DiffRow } from "../src/shared/changes";
import { type DiffItem, fileLines, fileTree, foldDiff, foldersAbove, treeOrder } from "./changes-model";

const same = (count: number, from = 1): DiffRow[] => Array.from({ length: count }, (_, at) => ({ sign: " ", old: from + at, new: from + at, text: "" }));
const added: DiffRow = { sign: "+", old: null, new: 0, text: "" };
const removed: DiffRow = { sign: "-", old: 0, new: null, text: "" };
const entry = (path: string): ChangedEntry => ({ path, status: "modified", added: 1, removed: 0, session: false });
const shown = (items: DiffItem[]) => items.map(item => (item.kind === "row" ? item.index : `fold ${item.from}-${item.to}`));

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
	test("joins chains of single folders, lists folders before files, and orders J and K by the tree", () => {
		const tree = fileTree([entry("README.md"), entry("web/components/changes/a.tsx"), entry("web/components/changes/b.tsx"), entry("src/z.ts"), entry("src/server/a.ts")]);
		expect(tree.dirs.map(dir => dir.name)).toEqual(["src", "web/components/changes"]);
		expect(tree.dirs[1]!.path).toBe("web/components/changes");
		expect(treeOrder(tree).map(file => file.path)).toEqual(["src/server/a.ts", "src/z.ts", "web/components/changes/a.tsx", "web/components/changes/b.tsx", "README.md"]);
		// J or K opening a file reopens the folders above it, a joined chain by its full path.
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