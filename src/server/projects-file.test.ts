import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { ProjectsFile } from "./projects-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-projects-"));
	dirs.push(dir);
	return join(dir, "project-list.json");
}

const AT = "2026-11-20T10:00:00.000Z";

test("a project with steps, a decision, a log line, and a session reads back the same after a restart", async () => {
	const path = projectsPath();
	const file = new ProjectsFile(path);
	file.apply({ op: "create", id: "p1", name: "Migration", goal: "Move to Postgres", at: AT });
	file.apply({ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" });
	file.apply({ op: "set-step", projectId: "p1", stepId: "s1", done: true });
	file.apply({ op: "add-decision", projectId: "p1", text: "Use pgvector" });
	file.apply({ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote the schema" });
	file.apply({ op: "join", projectId: "p1", sessionId: "a" });
	await flushJsonFiles();

	const expected = {
		projects: [
			{
				id: "p1",
				name: "Migration",
				goal: "Move to Postgres",
				steps: [{ id: "s1", text: "Schema", done: true }],
				decisions: ["Use pgvector"],
				log: [{ at: AT, sessionId: "a", text: "Wrote the schema" }],
				sessionIds: ["a"],
				createdAt: AT,
			},
		],
	};
	expect(new ProjectsFile(path).value).toEqual(expected);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(expected);
});

test("a change that changes nothing reports no change, and one the list refuses throws and leaves it as it was", () => {
	const file = new ProjectsFile(projectsPath());
	expect(file.apply({ op: "create", id: "p1", name: "Migration", goal: "", at: AT })).toBe(true);
	expect(file.apply({ op: "create", id: "p1", name: "Migration", goal: "", at: AT })).toBe(false);
	const before = file.value;
	expect(() => file.apply({ op: "set-step", projectId: "p1", stepId: "nope", done: true })).toThrow("Project Migration has no step nope.");
	expect(() => file.apply({ op: "join", projectId: "nope", sessionId: "a" })).toThrow("No project has id nope.");
	expect(file.value).toBe(before);
});
