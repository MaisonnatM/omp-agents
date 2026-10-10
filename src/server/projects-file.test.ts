import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PROJECT_NAME, type Project } from "../shared/projects";
import { applyProject, type ProjectChange, ProjectsFile } from "./projects-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-projects-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "projects.json");
}

const AT = "2026-10-10T08:00:00.000Z";
const create: ProjectChange = { op: "create", id: "p1", name: "  Billing\n v3 ", cwd: "/work/app", at: AT, coordinator: "s-c" };
const addWorker = (sessionId: string, title = "Schema"): ProjectChange => ({ op: "add-worker", id: "p1", title, sessionId, cwd: "/work/app", at: AT });

function apply(...changes: ProjectChange[]): Project[] {
	return changes.reduce(applyProject, [] as Project[]);
}

describe("applyProject", () => {
	test("create makes a project with its coordinator, one-line name, and no workers; the same id twice changes nothing", () => {
		const projects = apply(create);
		expect(projects).toEqual([
			{ id: "p1", name: "Billing v3", cwd: "/work/app", createdAt: AT, archived: false, coordinator: { sessionId: "s-c" }, workers: [], updates: [], nextWorker: 1 },
		]);
		expect(applyProject(projects, create)).toBe(projects);
		expect(apply({ ...create, name: " " })[0]?.name).toBe(DEFAULT_PROJECT_NAME);
	});

	test("rename and archive change only what differs", () => {
		const projects = apply(create);
		expect(applyProject(projects, { op: "rename", id: "p1", name: "Billing v3" })).toBe(projects);
		expect(applyProject(projects, { op: "rename", id: "p1", name: "Other" })[0]?.name).toBe("Other");
		const archived = applyProject(projects, { op: "archive", id: "p1" });
		expect(archived[0]?.archived).toBe(true);
		expect(applyProject(archived, { op: "archive", id: "p1" })).toBe(archived);
		expect(applyProject(projects, { op: "archive", id: "missing" })).toBe(projects);
	});

	test("workers take the next id in the order they attach, once per session", () => {
		const projects = apply(create, addWorker("s-a", "Copy"), addWorker("s-b", "Tests"));
		expect(projects[0]?.workers.map(({ id, title, sessionId }) => [id, title, sessionId])).toEqual([
			["w1", "Copy", "s-a"],
			["w2", "Tests", "s-b"],
		]);
		expect(projects[0]?.nextWorker).toBe(3);
		expect(applyProject(projects, addWorker("s-a"))).toBe(projects);
	});

	test("a relink follows a worker or coordinator to its new session id", () => {
		let projects = apply(create, addWorker("s-w1"));
		projects = applyProject(projects, { op: "relink", from: "s-w1", to: "s-w1b" });
		expect(projects[0]?.workers[0]?.sessionId).toBe("s-w1b");
		projects = applyProject(projects, { op: "relink", from: "s-c", to: "s-c2" });
		expect(projects[0]?.coordinator.sessionId).toBe("s-c2");
		expect(applyProject(projects, { op: "relink", from: "s-none", to: "s-x" })).toBe(projects);
	});

	test("updates queue once each until delivered, a reply lands on its worker, and a worker's later finished turn replaces its earlier one", () => {
		const stopped = { id: "u1", workerId: "w1", at: AT, kind: "stopped" as const };
		let projects = apply(create, addWorker("s-w1"), addWorker("s-w2"), { op: "update", id: "p1", update: stopped });
		expect(applyProject(projects, { op: "update", id: "p1", update: stopped })).toBe(projects);
		projects = applyProject(projects, { op: "reply", id: "p1", workerId: "w1", reply: { at: AT, text: "ok" } });
		expect(projects[0]?.workers[0]?.lastReply).toEqual({ at: AT, text: "ok" });
		for (const [id, workerId] of [
			["u2", "w1"],
			["u3", "w2"],
			["u4", "w1"],
		] as const) {
			projects = applyProject(projects, { op: "update", id: "p1", update: { id, workerId, at: AT, kind: "finished" } });
		}
		expect(projects[0]?.updates.map(update => update.id)).toEqual(["u1", "u3", "u4"]);
		projects = applyProject(projects, { op: "delivered", id: "p1", updateIds: ["u1", "u3", "u4"] });
		expect(projects[0]?.updates).toEqual([]);
		expect(applyProject(projects, { op: "delivered", id: "p1", updateIds: ["u1"] })).toBe(projects);
	});
});

describe("ProjectsFile", () => {
	test("a change is on disk once flushed, and the next server reads the same projects", () => {
		const path = projectsPath();
		const file = new ProjectsFile(path);
		expect(file.apply(create)).toBe(true);
		file.apply(addWorker("s-w1"));
		file.apply({ op: "update", id: "p1", update: { id: "u1", workerId: "w1", at: AT, kind: "asked", requestId: "r1", question: "Which?" } });
		file.flush();
		expect(JSON.parse(readFileSync(path, "utf8")).projects[0].coordinator.sessionId).toBe("s-c");
		const next = new ProjectsFile(path);
		expect(next.projects).toEqual(file.projects);
		expect(next.roleOf("s-w1")).toEqual({ projectId: "p1", role: "worker", workerId: "w1" });
		expect(next.roleOf("s-c")).toEqual({ projectId: "p1", role: "coordinator" });
		expect(next.roleOf("s-other")).toBeNull();
		expect(file.apply({ op: "rename", id: "p1", name: "Billing v3" })).toBe(false);
	});

	test("a change applies to what another server saved meanwhile, so neither server's projects are lost", () => {
		const path = projectsPath();
		const mine = new ProjectsFile(path);
		const theirs = new ProjectsFile(path);
		theirs.apply(create);
		theirs.flush();
		mine.apply({ ...create, id: "p2", coordinator: "s-c2" });
		theirs.apply(addWorker("s-w1"));
		theirs.flush();
		expect(new ProjectsFile(path).projects.map(project => [project.id, project.workers.length])).toEqual([
			["p1", 1],
			["p2", 0],
		]);
		expect(mine.get("p1")?.name).toBe("Billing v3");
	});

	test("reload reads what another server saved", () => {
		const path = projectsPath();
		const mine = new ProjectsFile(path);
		const theirs = new ProjectsFile(path);
		theirs.apply(create);
		theirs.flush();
		expect(mine.projects).toEqual([]);
		mine.reload();
		expect(mine.get("p1")?.name).toBe("Billing v3");
	});

	test("a file in another shape moves aside rather than being written over", () => {
		const path = projectsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ added: ["/a"], hidden: [] }));
		expect(new ProjectsFile(path).projects).toEqual([]);
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});
