import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProjectsFile } from "./projects-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-projects-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "projects.json");
}

describe("ProjectsFile", () => {
	test("adding shows a hidden directory, an added one stays added while hidden, and the next server reads the result", () => {
		const path = projectsPath();
		const first = new ProjectsFile(path);
		expect(first.apply({ op: "add", cwd: "/a" })).toBe(true);
		expect(first.apply({ op: "add", cwd: "/a" })).toBe(false);
		expect(first.apply({ op: "hide", cwd: "/b" })).toBe(true);
		expect(first.apply({ op: "add", cwd: "/b" })).toBe(true);
		expect(first.apply({ op: "hide", cwd: "/a" })).toBe(true);
		expect(first.apply({ op: "show", cwd: "/c" })).toBe(false);
		expect(new ProjectsFile(path).list).toEqual({ added: ["/a", "/b"], hidden: ["/a"] });
		expect(first.apply({ op: "show", cwd: "/a" })).toBe(true);
		expect(new ProjectsFile(path).list).toEqual({ added: ["/a", "/b"], hidden: [] });
	});

	test("a file holding relative paths moves aside rather than being written over", () => {
		const path = projectsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ added: ["code/app"], hidden: [] }));
		expect(new ProjectsFile(path).list).toEqual({ added: [], hidden: [] });
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});
