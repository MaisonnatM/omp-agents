import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editProjectMemory, MemoryEditRefused, projectMemoryView } from "./project-memory";

const dirs: string[] = [];
function repo(name: string): string {
	const dir = join(mkdtempSync(join(tmpdir(), "project-memory-test-")), name);
	dirs.push(dir);
	spawnSync("git", ["init", "-q", dir]);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(join(dir, ".."), { recursive: true, force: true });
});

const add = (slug: string, line: string) => ({ op: "add", slug, kind: "fact", line, body: "Detail." });

describe("project memory", () => {
	test("lists the repositories with memories first, then by name, each newest first", () => {
		const alpha = repo("alpha");
		const zulu = repo("zulu");
		editProjectMemory([alpha, zulu], { root: zulu, ops: [add("older", "Older fact")] }, "2026-11-01");
		editProjectMemory([alpha, zulu], { root: zulu, ops: [add("newer", "Newer fact")] }, "2026-11-19");
		const { repos } = projectMemoryView([alpha, zulu]);
		expect(repos.map(({ name, memories }) => [name, memories.map(({ slug }) => slug)])).toEqual([
			["zulu", ["newer", "older"]],
			["alpha", []],
		]);
		expect(repos[0]?.memories[0]).toEqual({ slug: "newer", kind: "fact", line: "Newer fact", body: "Detail.", source: "#dashboard", updated: "2026-11-19" });
	});

	test("edits and deletes through the memory's own checks", () => {
		const root = repo("app");
		editProjectMemory([root], { root, ops: [add("a-fact", "A fact")] }, "2026-11-19");
		const updated = editProjectMemory([root], { root, ops: [{ op: "update", slug: "a-fact", line: "A better fact" }] }, "2026-11-19");
		expect(updated.repos[0]?.memories.map(({ line }) => line)).toEqual(["A better fact"]);
		expect(editProjectMemory([root], { root, ops: [{ op: "delete", slug: "a-fact" }] }).repos[0]?.memories).toEqual([]);
	});

	test("refuses a root that is not one of the workspace repositories", () => {
		const root = repo("app");
		const other = repo("other");
		expect(() => editProjectMemory([root], { root: other, ops: [add("a-fact", "A fact")] })).toThrow(new MemoryEditRefused(`${other} is not one of the workspace repositories.`));
		expect(projectMemoryView([other]).repos[0]?.memories).toEqual([]);
	});

	test("refuses ops the memory refuses, with every reason", () => {
		const root = repo("app");
		expect(() => editProjectMemory([root], { root, ops: [{ op: "delete", slug: "missing" }, { op: "add", slug: "Bad Slug" }] })).toThrow(MemoryEditRefused);
		expect(() => editProjectMemory([root], { root, ops: [{ op: "update", slug: "missing", line: "x" }] })).toThrow("update missing: no memory has this slug; use add.");
		expect(() => editProjectMemory([root], { root, ops: "nope" })).toThrow("Expected { root, ops }.");
	});
});
