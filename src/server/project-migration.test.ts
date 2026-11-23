import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBoardFile } from "../board-module";
import { applyBoardChange, type BoardState, emptyBoard, planOf, projectOfSession, stepNumbers } from "../shared/board";
import { foldProjects, type LegacyProject, migrateProjectList, parseLegacyProjects } from "./project-migration";

const legacy = (over: Partial<LegacyProject> = {}): LegacyProject => ({
	id: "p1",
	name: "Board merge",
	goal: "One place for projects",
	steps: [
		{ id: "a", text: "Design", done: true },
		{ id: "b", text: "Build", done: false },
		{ id: "b1", text: "Server half", done: false, parentId: "b" },
	],
	decisions: ["Projects are channels"],
	log: [
		{ at: "2026-11-20T10:00:00.000Z", sessionId: "sess-1", text: "Started." },
		{ at: "2026-11-21T10:00:00.000Z", text: "Reviewed." },
	],
	sessionIds: ["sess-1"],
	createdAt: "2026-11-19T09:00:00.000Z",
	...over,
});

describe("foldProjects", () => {
	test("a project becomes a project channel with its plan, decisions, sessions, and log", () => {
		const board = foldProjects(emptyBoard("Maxence"), [legacy()], 0);
		const channel = board.channels.find(item => item.id === "c-project-p1")!;
		expect(channel).toEqual({
			id: "c-project-p1",
			name: "board-merge",
			about: "",
			project: { goal: "One place for projects", decisions: ["Projects are channels"], sessionIds: ["sess-1"], createdAt: Date.parse("2026-11-19T09:00:00.000Z") },
		});
		const plan = planOf(board, channel.id);
		expect(plan.map(step => [step.title, step.task])).toEqual([
			["Design", "done"],
			["Build", "open"],
			["Server half", "open"],
		]);
		expect([...stepNumbers(plan).values()]).toEqual(["1", "2", "2.1"]);
		expect(projectOfSession(board, "sess-1")?.id).toBe(channel.id);
		const log = board.threads.find(thread => thread.channel === channel.id && thread.title === "Log")!;
		expect(log.task).toBeNull();
		expect(board.messages.filter(msg => msg.thread === log.id).map(msg => [msg.author, msg.at, msg.text])).toEqual([
			["s-sess-1", Date.parse("2026-11-20T10:00:00.000Z"), "Started."],
			[board.me, Date.parse("2026-11-21T10:00:00.000Z"), "Reviewed."],
		]);
	});

	test("the result is a board the reducer accepts changes on, with names kept unique and archives in milliseconds", () => {
		const start = emptyBoard("Maxence");
		const withGeneral: BoardState = { ...start, channels: [...start.channels, { id: "c-x", name: "board-merge", about: "" }] };
		const board = foldProjects(withGeneral, [legacy({ log: [] }), legacy({ id: "p2", log: [], archivedAt: "2026-11-22T00:00:00.000Z" })], 0);
		expect(board.channels.filter(item => item.project).map(item => item.name)).toEqual(["board-merge-2", "board-merge-3"]);
		expect(board.channels.find(item => item.id === "c-project-p2")?.project?.archivedAt).toBe(Date.parse("2026-11-22T00:00:00.000Z"));
		expect(board.threads.some(thread => thread.title === "Log")).toBe(false);
		expect("ok" in applyBoardChange(board, { op: "task", thread: planOf(board, "c-project-p1")[1]!.id, task: "done", lease: null })).toBe(true);
	});

	test("a project already moved is skipped, and a time that does not parse falls back", () => {
		const once = foldProjects(emptyBoard("Maxence"), [legacy({ createdAt: "soon" })], 42);
		expect(once.channels.find(item => item.id === "c-project-p1")?.project?.createdAt).toBe(42);
		expect(foldProjects(once, [legacy()], 0)).toBe(once);
	});
});

describe("migrateProjectList", () => {
	let dir = "";
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("moves the file's projects into the board file and renames it, once", () => {
		dir = mkdtempSync(join(tmpdir(), "project-migration-"));
		const listPath = join(dir, "project-list.json");
		writeFileSync(listPath, JSON.stringify({ projects: [legacy()] }));
		const board = openBoardFile(join(dir, "board.json"));
		migrateProjectList(board, listPath, 0);
		expect(existsSync(listPath)).toBe(false);
		expect(parseLegacyProjects(JSON.parse(readFileSync(`${listPath}.migrated`, "utf8")))?.projects).toHaveLength(1);
		const saved = JSON.parse(readFileSync(join(dir, "board.json"), "utf8")) as BoardState;
		expect(saved.channels.some(item => item.id === "c-project-p1")).toBe(true);
		migrateProjectList(board, listPath, 0);
		expect(board.value.channels.filter(item => item.id === "c-project-p1")).toHaveLength(1);
	});

	test("leaves a file that holds no project list where it is", () => {
		dir = mkdtempSync(join(tmpdir(), "project-migration-"));
		const listPath = join(dir, "project-list.json");
		writeFileSync(listPath, "{ nope");
		const board = openBoardFile(join(dir, "board.json"));
		migrateProjectList(board, listPath, 0);
		expect(existsSync(listPath)).toBe(true);
		expect(board.value.channels.some(item => item.project)).toBe(false);
	});
});
