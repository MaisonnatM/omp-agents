import { describe, expect, test } from "bun:test";
import { applyWorkspace, NO_WORKSPACES, spaceIs, spaces } from "./workspaces";

describe("spaces", () => {
	const personalDir = { cwd: "/home/u/.local/share/omp-agents/personal", cwdDisplay: "~/.local/share/omp-agents/personal" };
	const { isPersonalDir, of } = spaces(["/home/u/code/garden"], personalDir);

	test("the personal directory is itself however omp or the page names it, `~` and a trailing slash included, and nothing beside it is", () => {
		expect([personalDir.cwd, `${personalDir.cwd}/`, ` ${personalDir.cwd}\n`, personalDir.cwdDisplay, `${personalDir.cwdDisplay}/`].map(isPersonalDir)).toEqual([true, true, true, true, true]);
		expect([`${personalDir.cwd}/recipes`, "/home/u/.local/share/omp-agents", `${personalDir.cwd}-old`, "~", "/"].map(isPersonalDir)).toEqual([false, false, false, false, false]);
	});

	test("the personal directory and a workspace placed in Personal, or a worktree counting in one, are Personal", () => {
		expect(of(personalDir.cwd, personalDir.cwd)).toBe("personal");
		expect(of(personalDir.cwdDisplay, personalDir.cwdDisplay)).toBe("personal");
		expect(of("/home/u/code/garden", "/home/u/code/garden")).toBe("personal");
		expect(of("/home/u/code/garden-wip", "/home/u/code/garden")).toBe("personal");
	});

	test("every other directory is Work, a subdirectory of the personal directory or of a Personal workspace included", () => {
		expect(of("/home/u/code/app", "/home/u/code/app")).toBe("work");
		expect(of(`${personalDir.cwd}/recipes`, `${personalDir.cwd}/recipes`)).toBe("work");
		expect(of("/home/u/code/garden/beds", "/home/u/code/garden/beds")).toBe("work");
	});

	test("a space's workspaces keep their order and their shape, directories or rows", () => {
		const placed = spaces(["/home/u/code/garden"], personalDir);
		const dirs = ["/home/u/code/app", personalDir.cwd, "/home/u/code/garden"];
		expect(placed.inSpace(dirs, "personal")).toEqual([personalDir.cwd, "/home/u/code/garden"]);
		expect(placed.inSpace(dirs, "work")).toEqual(["/home/u/code/app"]);
		const rows = dirs.map(cwd => ({ cwd, cwdDisplay: cwd }));
		expect(placed.inSpace(rows, "work")).toEqual([rows[0]]);
	});

	test("before the personal directory is known, only the listed workspaces are Personal", () => {
		const placed = spaces(["/home/u/code/garden"], null);
		expect(placed.isPersonalDir(personalDir.cwd)).toBe(false);
		expect(placed.of(personalDir.cwd, personalDir.cwd)).toBe("work");
		expect(placed.of("/home/u/code/garden", "/home/u/code/garden")).toBe("personal");
	});

	test("the page's rows name a Personal workspace both ways, so a Bot or a scheduled start at its `~` path is Personal too", () => {
		const placed = spaces([{ cwd: "/home/u/code/garden", cwdDisplay: "~/code/garden" }], personalDir);
		expect(placed.of("~/code/garden", "~/code/garden")).toBe("personal");
		expect(placed.of("/home/u/code/garden", "/home/u/code/garden")).toBe("personal");
		const bots = [{ name: "Home", cwd: personalDir.cwdDisplay }, { name: "Garden", cwd: "~/code/garden" }, { name: "Webapp", cwd: "~/code/webapp" }];
		expect(placed.inSpace(bots, "personal").map(({ name }) => name)).toEqual(["Home", "Garden"]);
		expect(placed.inSpace(bots, "work").map(({ name }) => name)).toEqual(["Webapp"]);
	});

	test("an item that carries its own space is in that space only", () => {
		const notes = [{ id: "a", space: "personal" as const }, { id: "b", space: "work" as const }];
		expect(notes.filter(spaceIs("personal")).map(({ id }) => id)).toEqual(["a"]);
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

	test("hiding a Personal workspace and showing it again keeps it Personal", () => {
		const placed = applyWorkspace(NO_WORKSPACES, { op: "space", cwd: "/a", space: "personal" });
		const hidden = applyWorkspace(placed, { op: "hide", cwd: "/a" });
		expect(hidden.personal).toEqual(["/a"]);
		expect(applyWorkspace(hidden, { op: "show", cwd: "/a" })).toEqual(placed);
	});
});
