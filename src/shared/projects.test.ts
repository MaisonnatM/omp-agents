import { describe, expect, test } from "bun:test";
import { applyProjectChange, stepNumbers, EMPTY_PROJECTS, parseProjectChange, parseProjectList, type ProjectChange, type ProjectList } from "./projects";

function applyAll(list: ProjectList, changes: ProjectChange[]): ProjectList {
	return changes.reduce((current, change) => {
		const next = applyProjectChange(current, change);
		if ("error" in next) throw new Error(next.error);
		return next.ok;
	}, list);
}

const AT = "2026-11-20T10:00:00.000Z";
const twoProjects = applyAll(EMPTY_PROJECTS, [
	{ op: "create", id: "p1", name: "Migration", goal: "Move to Postgres", at: AT },
	{ op: "create", id: "p2", name: "Launch", goal: "", at: AT },
]);

describe("parse", () => {
	test("a change keeps only the fields its op names, trimmed", () => {
		expect(parseProjectChange({ op: "add-step", projectId: "p1", stepId: "s1", text: "  Write the schema ", extra: 1 })).toEqual({
			ok: { op: "add-step", projectId: "p1", stepId: "s1", text: "Write the schema" },
		});
	});

	test("a change missing a field, of an unknown op, or too long is refused", () => {
		expect(parseProjectChange({ op: "set-step", projectId: "p1", stepId: "s1" })).toHaveProperty("error");
		expect(parseProjectChange({ op: "delete-everything" })).toHaveProperty("error");
		expect(parseProjectChange({ op: "rename", projectId: "p1", name: "x".repeat(201) })).toHaveProperty("error");
	});

	test("the list round-trips through JSON", () => {
		expect(parseProjectList(JSON.parse(JSON.stringify(twoProjects)))).toEqual(twoProjects);
	});
});

describe("applyProjectChange", () => {
	test("a step is added, ticked, edited, and removed", () => {
		const list = applyAll(twoProjects, [
			{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
			{ op: "add-step", projectId: "p1", stepId: "s2", text: "Backfill" },
			{ op: "set-step", projectId: "p1", stepId: "s1", done: true },
			{ op: "edit-step", projectId: "p1", stepId: "s2", text: "Backfill the rows" },
		]);
		expect(list.projects[0]!.steps).toEqual([
			{ id: "s1", text: "Schema", done: true },
			{ id: "s2", text: "Backfill the rows", done: false },
		]);
		expect(applyAll(list, [{ op: "remove-step", projectId: "p1", stepId: "s1" }]).projects[0]!.steps.map(step => step.id)).toEqual(["s2"]);
	});

	test("a change that changes nothing returns the same list, so a repeat writes nothing", () => {
		const list = applyAll(twoProjects, [
			{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
			{ op: "set-step", projectId: "p1", stepId: "s1", done: true },
			{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
			{ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote the schema" },
			{ op: "join", projectId: "p1", sessionId: "a" },
			{ op: "archive", projectId: "p2", at: AT },
		]);
		const repeats: ProjectChange[] = [
			{ op: "create", id: "p1", name: "Other", goal: "", at: AT },
			{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
			{ op: "set-step", projectId: "p1", stepId: "s1", done: true },
			{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
			{ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote the schema" },
			{ op: "join", projectId: "p1", sessionId: "a" },
			{ op: "archive", projectId: "p2", at: "2026-11-21T00:00:00.000Z" },
			{ op: "rename", projectId: "p1", name: "Migration" },
			{ op: "leave", sessionId: "nobody" },
		];
		for (const change of repeats) {
			const next = applyProjectChange(list, change);
			expect("ok" in next && next.ok).toBe(list);
		}
	});

	test("joining moves a session out of its other project, and leaving takes it out", () => {
		const joined = applyAll(twoProjects, [
			{ op: "join", projectId: "p1", sessionId: "a" },
			{ op: "join", projectId: "p2", sessionId: "a" },
		]);
		expect(joined.projects.map(project => project.sessionIds)).toEqual([[], ["a"]]);
		expect(applyAll(joined, [{ op: "leave", sessionId: "a" }]).projects.map(project => project.sessionIds)).toEqual([[], []]);
	});

	test("a change to a project or a step that does not exist is refused", () => {
		expect(applyProjectChange(twoProjects, { op: "join", projectId: "nope", sessionId: "a" })).toEqual({ error: "No project has id nope." });
		expect(applyProjectChange(twoProjects, { op: "set-step", projectId: "p1", stepId: "nope", done: true })).toEqual({ error: "Project Migration has no step nope." });
	});

	test("archive, then restore, gives back the project as it was", () => {
		const archived = applyAll(twoProjects, [{ op: "archive", projectId: "p1", at: AT }]);
		expect(archived.projects[0]!.archivedAt).toBe(AT);
		expect(applyAll(archived, [{ op: "restore", projectId: "p1" }]).projects[0]).toEqual(twoProjects.projects[0]!);
	});
});

describe("applyProjectChange, the page's edits", () => {
	test("rename and set-goal change only that field", () => {
		const list = applyAll(twoProjects, [
			{ op: "rename", projectId: "p1", name: "Postgres move" },
			{ op: "set-goal", projectId: "p2", goal: "Ship v1" },
		]);
		expect(list.projects.map(({ name, goal }) => ({ name, goal }))).toEqual([
			{ name: "Postgres move", goal: "Move to Postgres" },
			{ name: "Launch", goal: "Ship v1" },
		]);
	});

	test("a decision is added once, after the others, and removed by its text", () => {
		const list = applyAll(twoProjects, [
			{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
			{ op: "add-decision", projectId: "p1", text: "Keep MySQL read-only" },
			{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
		]);
		expect(list.projects[0]!.decisions).toEqual(["Use pgvector", "Keep MySQL read-only"]);
		const removed = applyAll(list, [{ op: "remove-decision", projectId: "p1", text: "Use pgvector" }]);
		expect(removed.projects[0]!.decisions).toEqual(["Keep MySQL read-only"]);
		expect(applyProjectChange(removed, { op: "remove-decision", projectId: "p1", text: "Use pgvector" })).toEqual({ ok: removed });
	});

	test("log lines append oldest first, a line the page wrote has no session, and the same text at another time is a new line", () => {
		const list = applyAll(twoProjects, [
			{ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote the schema" },
			{ op: "log", projectId: "p1", at: AT, text: "Reviewed it" },
			{ op: "log", projectId: "p1", at: "2026-11-21T10:00:00.000Z", sessionId: "a", text: "Wrote the schema" },
		]);
		expect(list.projects[0]!.log).toEqual([
			{ at: AT, sessionId: "a", text: "Wrote the schema" },
			{ at: AT, text: "Reviewed it" },
			{ at: "2026-11-21T10:00:00.000Z", sessionId: "a", text: "Wrote the schema" },
		]);
		expect(parseProjectChange({ op: "log", projectId: "p1", at: AT, sessionId: "", text: "x" })).toHaveProperty("error");
	});

	test("editing a missing step is refused, removing one changes nothing, and any change to a missing project is refused", () => {
		expect(applyProjectChange(twoProjects, { op: "edit-step", projectId: "p1", stepId: "nope", text: "x" })).toEqual({ error: "Project Migration has no step nope." });
		expect(applyProjectChange(twoProjects, { op: "remove-step", projectId: "p1", stepId: "nope" })).toEqual({ ok: twoProjects });
		for (const change of [
			{ op: "rename", projectId: "nope", name: "x" },
			{ op: "set-goal", projectId: "nope", goal: "x" },
			{ op: "archive", projectId: "nope", at: AT },
			{ op: "restore", projectId: "nope" },
			{ op: "add-step", projectId: "nope", stepId: "s1", text: "x" },
			{ op: "add-decision", projectId: "nope", text: "x" },
			{ op: "log", projectId: "nope", at: AT, text: "x" },
		] satisfies ProjectChange[])
			expect(applyProjectChange(twoProjects, change)).toEqual({ error: "No project has id nope." });
	});

	test("restoring an open project changes nothing", () => {
		expect(applyProjectChange(twoProjects, { op: "restore", projectId: "p1" })).toEqual({ ok: twoProjects });
	});
});

describe("sub-steps", () => {
	const nested = applyAll(twoProjects, [
		{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
		{ op: "add-step", projectId: "p1", stepId: "s2", text: "Backfill" },
		{ op: "add-step", projectId: "p1", stepId: "s1a", text: "Tables", parentId: "s1" },
		{ op: "add-step", projectId: "p1", stepId: "s1b", text: "Indexes", parentId: "s1" },
	]);
	const steps = nested.projects[0]!.steps;

	test("a sub-step lands after its parent's last sub-step and is numbered under it", () => {
		expect(steps.map(step => step.id)).toEqual(["s1", "s1a", "s1b", "s2"]);
		expect([...stepNumbers(steps).values()]).toEqual(["1", "1.1", "1.2", "2"]);
	});

	test("a plan nests two levels at most, and a sub-step needs a parent that exists", () => {
		expect(applyProjectChange(nested, { op: "add-step", projectId: "p1", stepId: "x", text: "Deeper", parentId: "s1a" })).toEqual({ error: expect.stringContaining("two levels at most") });
		expect(applyProjectChange(nested, { op: "add-step", projectId: "p1", stepId: "x", text: "Orphan", parentId: "gone" })).toEqual({ error: expect.stringContaining("gone") });
	});

	test("removing a step removes its sub-steps", () => {
		expect(applyAll(nested, [{ op: "remove-step", projectId: "p1", stepId: "s1" }]).projects[0]!.steps.map(step => step.id)).toEqual(["s2"]);
	});

	test("a sub-step's parent survives the file's round trip", () => {
		expect(parseProjectList(JSON.parse(JSON.stringify(nested)))).toEqual(nested);
		expect(parseProjectChange({ op: "add-step", projectId: "p1", stepId: "x", text: "Tables", parentId: "s1" })).toEqual({ ok: { op: "add-step", projectId: "p1", stepId: "x", text: "Tables", parentId: "s1" } });
	});
});
