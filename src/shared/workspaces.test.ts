import { describe, expect, test } from "bun:test";
import { applyWorkspace, NO_WORKSPACES, spaceOf } from "./workspaces";

describe("spaceOf", () => {
	const personalDir = "/home/u/.local/share/omp-agents/personal";
	const personal = ["/home/u/code/garden"];

	test("the personal directory and a workspace placed in Personal, or a worktree counting in one, are Personal", () => {
		expect(spaceOf({ cwd: personalDir, workspace: personalDir }, [], personalDir)).toBe("personal");
		expect(spaceOf({ cwd: "/home/u/code/garden", workspace: "/home/u/code/garden" }, personal, personalDir)).toBe("personal");
		expect(spaceOf({ cwd: "/home/u/code/garden-wip", workspace: "/home/u/code/garden" }, personal, personalDir)).toBe("personal");
	});

	test("every other directory is Work, a subdirectory of the personal directory or of a Personal workspace included", () => {
		expect(spaceOf({ cwd: "/home/u/code/app", workspace: "/home/u/code/app" }, personal, personalDir)).toBe("work");
		expect(spaceOf({ cwd: `${personalDir}/recipes`, workspace: `${personalDir}/recipes` }, personal, personalDir)).toBe("work");
		expect(spaceOf({ cwd: "/home/u/code/garden/beds", workspace: "/home/u/code/garden/beds" }, personal, personalDir)).toBe("work");
	});
});

describe("applyWorkspace", () => {
	test("placing a directory in a space lists it in personal or takes it out, and changes nothing else", () => {
		const added = applyWorkspace(NO_WORKSPACES, { op: "add", cwd: "/a" });
		const placed = applyWorkspace(added, { op: "space", cwd: "/a", space: "personal" });
		expect(placed).toEqual({ added: ["/a"], hidden: [], personal: ["/a"] });
		expect(applyWorkspace(placed, { op: "space", cwd: "/a", space: "personal" })).toBe(placed);
		expect(applyWorkspace(placed, { op: "space", cwd: "/a", space: "work" })).toEqual(added);
		expect(applyWorkspace(added, { op: "space", cwd: "/a", space: "work" })).toBe(added);
	});
});
