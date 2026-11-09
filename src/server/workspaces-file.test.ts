import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { adoptOldWorkspaces, WorkspacesFile } from "./workspaces-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspacesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-workspaces-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "workspaces.json");
}

/** The `projects.json` beside `path`, where an older version saved the list. */
const oldPathOf = (path: string): string => join(dirname(path), "projects.json");

/** The store at `path`, once it took over the list from the `projects.json` beside it, as the server does at startup. */
function workspacesFile(path: string): WorkspacesFile {
	adoptOldWorkspaces(oldPathOf(path), path);
	return new WorkspacesFile(path);
}

describe("WorkspacesFile", () => {
	test("adding shows a hidden directory, an added one stays added while hidden, and the next server reads the result", () => {
		const path = workspacesPath();
		const first = workspacesFile(path);
		expect(first.apply({ op: "add", cwd: "/a" })).toBe(true);
		expect(first.apply({ op: "add", cwd: "/a" })).toBe(false);
		expect(first.apply({ op: "hide", cwd: "/b" })).toBe(true);
		expect(first.apply({ op: "add", cwd: "/b" })).toBe(true);
		expect(first.apply({ op: "hide", cwd: "/a" })).toBe(true);
		expect(first.apply({ op: "show", cwd: "/c" })).toBe(false);
		expect(workspacesFile(path).value).toEqual({ added: ["/a", "/b"], hidden: ["/a"], personal: [] });
		expect(first.apply({ op: "show", cwd: "/a" })).toBe(true);
		expect(workspacesFile(path).value).toEqual({ added: ["/a", "/b"], hidden: [], personal: [] });
	});

	test("placing a directory in the Personal space lists it, placing it there again changes nothing, and placing it in Work takes it out", () => {
		const path = workspacesPath();
		const file = workspacesFile(path);
		expect(file.apply({ op: "space", cwd: "/home", space: "personal" })).toBe(true);
		expect(file.apply({ op: "space", cwd: "/home", space: "personal" })).toBe(false);
		expect(file.apply({ op: "space", cwd: "/app", space: "work" })).toBe(false);
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: ["/home"] });
		expect(file.apply({ op: "space", cwd: "/home", space: "work" })).toBe(true);
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: [] });
	});

	test("a file an older version wrote, without personal, reads as every workspace in Work", () => {
		const path = workspacesPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ added: ["/a"], hidden: [] }));
		expect(workspacesFile(path).value).toEqual({ added: ["/a"], hidden: [], personal: [] });
		expect(existsSync(`${path}.invalid`)).toBe(false);
	});

	test("a file holding relative paths moves aside rather than being written over", () => {
		const path = workspacesPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ added: ["code/app"], hidden: [] }));
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: [] });
		expect(existsSync(`${path}.invalid`)).toBe(true);
		writeFileSync(path, JSON.stringify({ added: [], hidden: [], personal: ["code/app"] }));
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: [] });
	});

	test("takes over the list an older version saved in projects.json", () => {
		const path = workspacesPath();
		const oldPath = oldPathOf(path);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(oldPath, JSON.stringify({ added: ["/a"], hidden: ["/b"] }));
		expect(workspacesFile(path).value).toEqual({ added: ["/a"], hidden: ["/b"], personal: [] });
		expect(existsSync(oldPath)).toBe(false);
		expect(existsSync(path)).toBe(true);
	});

	test("leaves both files as they are when workspaces.json exists already", () => {
		const path = workspacesPath();
		const oldPath = oldPathOf(path);
		mkdirSync(dirname(path), { recursive: true });
		const saved = JSON.stringify({ added: ["/a"], hidden: [] });
		writeFileSync(path, saved);
		writeFileSync(oldPath, JSON.stringify({ added: ["/c"], hidden: [] }));
		expect(workspacesFile(path).value).toEqual({ added: ["/a"], hidden: [], personal: [] });
		expect(readFileSync(path, "utf8")).toBe(saved);
		expect(existsSync(oldPath)).toBe(true);
	});

	test("leaves a projects.json that holds something other than a workspace list where it is", () => {
		const path = workspacesPath();
		const oldPath = oldPathOf(path);
		mkdirSync(dirname(path), { recursive: true });
		const other = JSON.stringify({ projects: [{ name: "Launch", cwds: ["/a"] }] });
		writeFileSync(oldPath, other);
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: [] });
		expect(readFileSync(oldPath, "utf8")).toBe(other);
		expect(existsSync(path)).toBe(false);
	});

	test("starts empty when neither file exists", () => {
		const path = workspacesPath();
		mkdirSync(dirname(path), { recursive: true });
		expect(workspacesFile(path).value).toEqual({ added: [], hidden: [], personal: [] });
	});
});
