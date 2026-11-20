import { describe, expect, test } from "bun:test";
import { applyProjectChange, type Project as DashboardProject, EMPTY_PROJECTS, MAX_PROJECT_NAME, MAX_PROJECT_TEXT, type ProjectChange as DashboardChange, type ProjectList } from "../../src/shared/projects";
import { briefText, findDecision, findProject, findStep, listText, MAX_NAME, MAX_TEXT, type Project, type ProjectChange, projectOfSession, projectsIn, withWaiting } from "./agent/extensions/project/brief";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("the kit's copy of the dashboard's project list", () => {
	test("keeps the dashboard's project shape, its changes, and its length limits", () => {
		const sameProject: Same<Project, Omit<DashboardProject, "createdAt">> = true;
		const sameChange: Same<ProjectChange, DashboardChange> = true;
		expect([sameProject, sameChange]).toEqual([true, true]);
		expect([MAX_NAME, MAX_TEXT]).toEqual([MAX_PROJECT_NAME, MAX_PROJECT_TEXT]);
	});

	test("folds every change as the dashboard's reducer does, leaving a refused one out", () => {
		const AT = "2026-11-20T10:00:00.000Z";
		const changes: ProjectChange[] = [
			{ op: "create", id: "p1", name: "Migration", goal: "", at: AT },
			{ op: "create", id: "p2", name: "Launch", goal: "Ship", at: AT },
			{ op: "join", projectId: "p1", sessionId: "a" },
			{ op: "join", projectId: "p2", sessionId: "a" },
			{ op: "join", projectId: "p1", sessionId: "b" },
			{ op: "rename", projectId: "p1", name: "Postgres" },
			{ op: "set-goal", projectId: "p1", goal: "Move to Postgres" },
			{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
			{ op: "add-step", projectId: "p1", stepId: "s2", text: "Backfill" },
			{ op: "set-step", projectId: "p1", stepId: "s1", done: true },
			{ op: "edit-step", projectId: "p1", stepId: "s2", text: "Backfill the rows" },
			{ op: "remove-step", projectId: "p1", stepId: "s1" },
			{ op: "add-decision", projectId: "p1", text: "Use pgvector" },
			{ op: "add-decision", projectId: "p1", text: "Keep MySQL" },
			{ op: "remove-decision", projectId: "p1", text: "Keep MySQL" },
			{ op: "log", projectId: "p1", at: AT, sessionId: "a", text: "Wrote it" },
			{ op: "log", projectId: "p1", at: AT, text: "Checked it" },
			{ op: "archive", projectId: "p2", at: AT },
			{ op: "restore", projectId: "p2" },
			{ op: "archive", projectId: "p2", at: AT },
			{ op: "leave", sessionId: "b" },
			{ op: "rename", projectId: "gone", name: "Nothing" },
			{ op: "join", projectId: "gone", sessionId: "a" },
		];
		const dashboard = changes.reduce<ProjectList>(
			(list, change) => {
				const next = applyProjectChange(list, change);
				return "ok" in next ? next.ok : list;
			},
			EMPTY_PROJECTS,
		);
		expect(withWaiting([], changes)).toEqual(dashboard.projects.map(({ createdAt: _, ...project }) => project));
	});
});

const migration: Project = {
	id: "p1",
	name: "Migration",
	goal: "Move the app to Postgres",
	steps: [
		{ id: "s1", text: "Write the schema", done: true },
		{ id: "s2", text: "Backfill the rows", done: false },
	],
	decisions: ["Use pgvector for embeddings"],
	log: Array.from({ length: 12 }, (_, index) => ({ at: `2026-11-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`, sessionId: index === 11 ? "me" : "other", text: `Line ${index + 1}` })),
	sessionIds: ["me", "other"],
};
const launch: Project = { id: "p2", name: "Launch", goal: "", steps: [], decisions: [], log: [], sessionIds: [] };
const archived: Project = { ...launch, id: "p3", name: "Old", sessionIds: ["gone"], archivedAt: "2026-11-01T00:00:00.000Z" };

describe("briefText", () => {
	test("gives the goal, the plan with what is done, the decisions, and the 10 newest log lines", () => {
		const brief = briefText(migration, "me");
		expect(brief).toContain('This session is part of the project "Migration" (id p1)');
		expect(brief).toContain("Goal: Move the app to Postgres");
		expect(brief).toContain("Plan (1 of 2 done):\n1. [x] Write the schema\n2. [ ] Backfill the rows");
		expect(brief).toContain("Decisions:\n1. Use pgvector for embeddings");
		expect(brief).toContain("Latest log, oldest first (the last 10 of 12):\n- 2026-11-03 session other: Line 3");
		expect(brief).toContain("- 2026-11-12 this session: Line 12");
		expect(brief).not.toContain("Line 2\n");
		expect(brief).toContain("tick it with project_update");
	});

	test("says what an empty project lacks", () => {
		const brief = briefText(launch, "me");
		expect(brief).toContain("Goal: not set yet");
		expect(brief).toContain("Plan: no steps yet.");
		expect(brief).not.toContain("Decisions:");
		expect(brief).not.toContain("Latest log");
	});
});

describe("lookups", () => {
	test("a session's project is the open one that lists it, counting the changes waiting in the inbox", () => {
		const projects = [migration, launch, archived];
		expect(projectOfSession(projects, "me")?.id).toBe("p1");
		expect(projectOfSession(projects, "gone")).toBeNull();
		expect(projectOfSession(withWaiting(projects, [{ op: "join", projectId: "p2", sessionId: "me" }]), "me")?.id).toBe("p2");
		expect(projectOfSession(withWaiting(projects, [{ op: "join", projectId: "p2", sessionId: "other-session" }]), "new")).toBeNull();
		const added = withWaiting(projects, [
			{ op: "join", projectId: "p2", sessionId: "new" },
			{ op: "add-step", projectId: "p2", stepId: "s9", text: "Ship it" },
			{ op: "set-step", projectId: "p2", stepId: "s9", done: true },
		]);
		expect(projectOfSession(added, "new")?.steps).toEqual([{ id: "s9", text: "Ship it", done: true }]);
	});

	test("the project list file loses a malformed project and reads as none when unreadable", () => {
		expect(projectsIn({ projects: [launch, { id: "p9", name: "No plan" }, null] })).toEqual([launch]);
		expect(projectsIn(null)).toEqual([]);
		expect(projectsIn({ projects: "nope" })).toEqual([]);
	});

	test("a project is found by id or by name ignoring case, archived ones included", () => {
		const projects = [migration, launch, archived];
		expect(findProject(projects, "p2")).toEqual({ project: launch });
		expect(findProject(projects, " migration ")).toEqual({ project: migration });
		expect(findProject(projects, "Old")).toEqual({ project: archived });
		expect(findProject(projects, "Nope")).toEqual({ error: 'No project has the id or name "Nope"; project_list lists them.' });
		expect(findProject([migration, { ...launch, name: "Migration" }], "Migration")).toEqual({ error: 'Several projects are named "Migration"; name one by its id: p1, p2.' });
	});

	test("a decision is found by its number in the brief or its exact text", () => {
		expect(findDecision(migration, "1")).toBe("Use pgvector for embeddings");
		expect(findDecision(migration, "Use pgvector for embeddings")).toBe("Use pgvector for embeddings");
		expect(findDecision(migration, "2")).toBeNull();
	});

	test("the list gives every project, open ones first, with its id, status, progress, and goal", () => {
		expect(listText([archived, migration, launch], "me")).toBe(
			[
				"- Migration (id p1), open, this session's project, 1 of 2 steps done, goal: Move the app to Postgres",
				"- Launch (id p2), open, 0 of 0 steps done",
				"- Old (id p3), archived, 0 of 0 steps done",
			].join("\n"),
		);
		expect(listText([], "me")).toBe("There is no project yet; create one with project_update.");
	});

	test("a step is found by its number in the brief or its exact text", () => {
		expect(findStep(migration, "2")?.id).toBe("s2");
		expect(findStep(migration, "Write the schema")?.id).toBe("s1");
		expect(findStep(migration, "3")).toBeNull();
	});
});

test("a brief credits a log line with no session to the user, and names no cut when the whole log fits", () => {
	const brief = briefText({ ...launch, log: [{ at: "2026-11-20T09:00:00.000Z", text: "Picked the vendor" }] }, "me");
	expect(brief).toContain("Latest log, oldest first:\n- 2026-11-20 the user: Picked the vendor");
});

test("sub-steps fold as the dashboard's reducer folds them, and the brief numbers and finds them under their step", () => {
	const changes: ProjectChange[] = [
		{ op: "create", id: "p1", name: "Migration", goal: "", at: "2026-11-20T10:00:00.000Z" },
		{ op: "add-step", projectId: "p1", stepId: "s1", text: "Schema" },
		{ op: "add-step", projectId: "p1", stepId: "s2", text: "Backfill" },
		{ op: "add-step", projectId: "p1", stepId: "s1a", text: "Tables", parentId: "s1" },
		{ op: "add-step", projectId: "p1", stepId: "deep", text: "Too deep", parentId: "s1a" },
		{ op: "add-step", projectId: "p1", stepId: "s1b", text: "Indexes", parentId: "s1" },
	];
	const [kit] = withWaiting([], changes);
	const dashboard = changes.reduce<ProjectList>((list, change) => {
		const next = applyProjectChange(list, change);
		return "ok" in next ? next.ok : list;
	}, EMPTY_PROJECTS);
	expect(kit!.steps).toEqual(dashboard.projects[0]!.steps);
	expect(briefText(kit!, "me")).toContain("sub-step of step 2):\n1. [ ] Schema\n   1.1. [ ] Tables\n   1.2. [ ] Indexes\n2. [ ] Backfill");
	expect(findStep(kit!, "1.2")?.id).toBe("s1b");
	expect(findStep(kit!, "2")?.id).toBe("s2");
});
