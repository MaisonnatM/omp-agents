import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectChange } from "../shared/projects";
import { ProjectsFile } from "./projects-file";
import { ProjectsInbox } from "./projects-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-project-inbox-"));
	dirs.push(dir);
	return dir;
}

const AT = "2026-11-20T10:00:00.000Z";

/** An inbox in `dir` over a project list holding project p1, applying each change as the server's module does. */
function harness(dir: string) {
	const file = new ProjectsFile(join(tempDir(), "project-list.json"));
	file.apply({ op: "create", id: "p1", name: "Migration", goal: "", at: AT });
	file.apply({ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" });
	const applied: ProjectChange[] = [];
	const inbox = new ProjectsInbox(dir, change => {
		applied.push(change);
		file.apply(change);
		return true;
	});
	return { inbox, file, applied };
}

test("applies every change the page makes, on any project, in name order, and sets aside garbage, an unknown op, and a change the list refuses", async () => {
	const dir = tempDir();
	const changes: unknown[] = [
		{ op: "join", projectId: "p1", sessionId: "a" },
		{ op: "set-step", projectId: "p1", stepId: "s1", done: true },
		{ op: "add-step", projectId: "p1", stepId: "s2", text: " Backfill " },
		{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
		{ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote the schema" },
		{ op: "rename", projectId: "p1", name: "Postgres move" },
		{ op: "create", id: "p2", name: "Launch", goal: "Ship it", at: AT },
		{ op: "join", projectId: "p2", sessionId: "b" },
		{ op: "remove-step", projectId: "p1", stepId: "s1" },
		{ op: "edit-step", projectId: "p1", stepId: "s2", text: "Backfill the rows" },
		{ op: "remove-decision", projectId: "p1", text: "Use pgvector" },
		{ op: "archive", projectId: "p2", at: AT },
		{ op: "leave", sessionId: "a" },
		{ op: "set-step", projectId: "p1", stepId: "nope", done: true },
		"{not json",
		{ op: "delete-everything" },
	];
	changes.forEach((value, index) => writeFileSync(join(dir, `${String(index + 1).padStart(2, "0")}.json`), typeof value === "string" ? value : JSON.stringify(value)));
	const logged = spyOn(console, "error").mockImplementation(() => {});
	const { inbox, file, applied } = harness(dir);
	await inbox.drain();
	logged.mockRestore();

	expect(applied.map(change => change.op)).toEqual(["join", "set-step", "add-step", "add-decision", "log", "rename", "create", "join", "remove-step", "edit-step", "remove-decision", "archive", "leave", "set-step"]);
	expect(file.value.projects).toEqual([
		{ id: "p1", name: "Postgres move", goal: "", steps: [{ id: "s2", text: "Backfill the rows", done: false }], decisions: [], log: [{ at: AT, sessionId: "a", text: "Wrote the schema" }], sessionIds: [], createdAt: AT },
		{ id: "p2", name: "Launch", goal: "Ship it", steps: [], decisions: [], log: [], sessionIds: ["b"], createdAt: AT, archivedAt: AT },
	]);
	expect(readdirSync(dir).sort()).toEqual(["14.json.invalid", "15.json.invalid", "16.json.invalid"]);
});

test("a change whose apply has not reached the list's file stays for a later drain", async () => {
	const dir = tempDir();
	writeFileSync(join(dir, "1.json"), JSON.stringify({ op: "join", projectId: "p1", sessionId: "a" }));
	let reached = false;
	const inbox = new ProjectsInbox(dir, () => reached);
	await inbox.drain();
	expect(readdirSync(dir)).toEqual(["1.json"]);
	reached = true;
	await inbox.drain();
	expect(readdirSync(dir)).toEqual([]);
});
