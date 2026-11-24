import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_PROJECTS, type Project } from "../shared/projects";
import { foldBoardProjects, migrateBoardProjects, parseOldBoard } from "./project-migration";
import { ProjectsFile } from "./projects-file";

const at = (iso: string) => Date.parse(iso);

/** A `board.json` as the Board saved it, with the fields the migration drops. */
const raw = () => ({
	version: 1,
	me: "Maxence",
	channels: [
		{ id: "c-general", name: "general", about: "" },
		{
			id: "c-project-p1",
			name: "launch",
			about: "",
			project: { goal: "Ship it", decisions: ["Use Bun"], sessionIds: ["sess-1"], createdAt: at("2026-11-19T09:00:00.000Z"), archivedAt: at("2026-11-25T09:00:00.000Z") },
		},
	],
	threads: [
		{ id: "t-project-p1-a", channel: "c-project-p1", title: "Design", task: "done", lease: null, createdAt: 1 },
		{ id: "t-project-p1-b", channel: "c-project-p1", title: "Build", task: "claimed", lease: { by: "s-sess-1", until: 9 }, createdAt: 2 },
		{ id: "t-project-p1-log", channel: "c-project-p1", title: "Log", task: null, lease: null, createdAt: 3 },
		{ id: "t-project-p1-b1", channel: "c-project-p1", title: "Server half", task: "review", lease: null, createdAt: 4, parent: "t-project-p1-b" },
		{ id: "t-chat", channel: "c-general", title: "Chat", task: null, lease: null, createdAt: 5 },
	],
	messages: [
		{ id: "m2", thread: "t-project-p1-b", author: "u-maxence", at: at("2026-11-21T10:00:00.000Z"), text: "Picked up." },
		{ id: "m1", thread: "t-project-p1-log", author: "s-sess-1", at: at("2026-11-20T10:00:00.000Z"), text: "Started." },
		{ id: "m3", thread: "t-project-p1-log", author: "bot:ann", at: at("2026-11-22T10:00:00.000Z"), text: "Checked." },
		{ id: "m4", thread: "t-chat", author: "s-sess-2", at: 0, text: "Not a project's." },
	],
	extraMembers: [{ id: "bot:ann", name: "Ann", kind: "agent", sessionId: "sess-ann" }],
	schedules: [],
	readAt: {},
});

const board = () => parseOldBoard(raw())!;

const migrated: Project = {
	id: "p1",
	name: "launch",
	goal: "Ship it",
	steps: [
		{ id: "a", text: "Design", done: true },
		{ id: "b", text: "Build", done: false },
		{ id: "b1", text: "Server half", done: false, parentId: "b" },
	],
	decisions: ["Use Bun"],
	log: [
		{ at: "2026-11-20T10:00:00.000Z", sessionId: "sess-1", text: "Started." },
		{ at: "2026-11-21T10:00:00.000Z", text: "Build: Picked up." },
		{ at: "2026-11-22T10:00:00.000Z", sessionId: "sess-ann", text: "Checked." },
	],
	sessionIds: ["sess-1"],
	createdAt: "2026-11-19T09:00:00.000Z",
	archivedAt: "2026-11-25T09:00:00.000Z",
};

describe("foldBoardProjects", () => {
	test("each project channel becomes a project with its plan, decisions, sessions, and messages as its log", () => {
		expect(foldBoardProjects(EMPTY_PROJECTS, board())).toEqual({ projects: [migrated] });
	});

	test("a project already in the list stays as it is, so a second fold changes nothing", () => {
		const once = foldBoardProjects(EMPTY_PROJECTS, board());
		expect(foldBoardProjects(once, board())).toBe(once);
	});

	test("a sub-step whose parent is no top-level step becomes a top-level step", () => {
		const state = board();
		state.threads = state.threads.filter(thread => thread.id !== "t-project-p1-b");
		expect(foldBoardProjects(EMPTY_PROJECTS, state).projects[0]?.steps).toEqual([
			{ id: "a", text: "Design", done: true },
			{ id: "b1", text: "Server half", done: false },
		]);
	});
});

describe("migrateBoardProjects", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	const scratch = () => {
		const dir = mkdtempSync(join(tmpdir(), "project-migration-"));
		dirs.push(dir);
		return { listPath: join(dir, "project-list.json"), boardPath: join(dir, "board.json") };
	};

	test("saves the Board's projects beside those already listed, then renames board.json", () => {
		const { listPath, boardPath } = scratch();
		const kept: Project = { id: "p0", name: "Older", goal: "", steps: [], decisions: [], log: [], sessionIds: [], createdAt: "2026-11-01T00:00:00.000Z" };
		writeFileSync(listPath, JSON.stringify({ projects: [kept] }));
		writeFileSync(boardPath, JSON.stringify(raw()));
		const file = new ProjectsFile(listPath);
		migrateBoardProjects(file, boardPath);
		expect(file.value.projects).toEqual([kept, migrated]);
		expect(JSON.parse(readFileSync(listPath, "utf8")).projects).toEqual([kept, migrated]);
		expect(existsSync(boardPath)).toBe(false);
		expect(existsSync(`${boardPath}.removed`)).toBe(true);
	});

	test("leaves a board.json that holds no board where it is, and does nothing without one", () => {
		const { listPath, boardPath } = scratch();
		const file = new ProjectsFile(listPath);
		migrateBoardProjects(file, boardPath);
		writeFileSync(boardPath, "{ not json");
		migrateBoardProjects(file, boardPath);
		expect(file.value).toEqual(EMPTY_PROJECTS);
		expect(existsSync(boardPath)).toBe(true);
	});
});
