import { describe, expect, test } from "bun:test";
import { fileTree, foldersAbove, treeOrder } from "./file-tree";

const leaf = (path: string) => ({ path });

describe("fileTree", () => {
	test("joins chains of single folders, lists folders before files, and orders ↓ and ↑ by the tree", () => {
		const tree = fileTree([leaf("README.md"), leaf("web/components/changes/a.tsx"), leaf("web/components/changes/b.tsx"), leaf("src/z.ts"), leaf("src/server/a.ts")]);
		expect(tree.dirs.map(dir => dir.name)).toEqual(["src", "web/components/changes"]);
		expect(tree.dirs[1]!.path).toBe("web/components/changes");
		expect(treeOrder(tree).map(file => file.path)).toEqual(["src/server/a.ts", "src/z.ts", "web/components/changes/a.tsx", "web/components/changes/b.tsx", "README.md"]);
		// ↓ or ↑ opening a file reopens the folders above it, a joined chain by its full path.
		expect(foldersAbove(tree, "src/server/a.ts")).toEqual(["src", "src/server"]);
		expect(foldersAbove(tree, "web/components/changes/b.tsx")).toEqual(["web/components/changes"]);
		expect(foldersAbove(tree, "README.md")).toEqual([]);
	});

	test("an absolute path hangs under one `/` folder, joined with its single folders", () => {
		const tree = fileTree([leaf("/tmp/x/notes.md"), leaf("a.ts")]);
		expect(tree.dirs.map(dir => dir.name)).toEqual(["/tmp/x"]);
		expect(treeOrder(tree).map(file => file.path)).toEqual(["/tmp/x/notes.md", "a.ts"]);
	});
});
