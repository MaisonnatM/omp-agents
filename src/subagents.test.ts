import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentStatus } from "./shared";
import { type HostAgent, parseAgents, parseSubagentFrame, SUBAGENT_LIFECYCLE, SUBAGENT_PROGRESS, SubagentFiles } from "./subagents";

/**
 * A search for a subagent runs on after its test body ends, and one that finds nothing never signals, so the
 * directories go at process exit: removing them per test would make a search still scanning fail on a vanished file.
 */
const roots: string[] = [];
process.on("exit", () => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const agent = (id: string, extra: Partial<HostAgent> = {}): HostAgent => ({
	id,
	type: "explore",
	isMain: false,
	parentId: null,
	status: "running" as AgentStatus,
	createdAt: 0,
	...extra,
});

/** A project directory holding the session file `sessionFile`, with finds counted through a promise per find. */
function setup() {
	const project = mkdtempSync(join(tmpdir(), "omp-agents-subagents-"));
	roots.push(project);
	const sessionFile = join(project, "2026-10-01T12-00-00_aaaa.jsonl");
	writeFileSync(sessionFile, "");
	let finds = 0;
	let found = Promise.withResolvers<void>();
	const files = new SubagentFiles(() => {
		finds++;
		found.resolve();
		found = Promise.withResolvers<void>();
	});
	const nextFind = (): Promise<void> => found.promise;
	return { project, sessionFile, files, finds: () => finds, nextFind };
}

/** Write an empty transcript at `path` last modified at `mtimeMs`. */
function transcript(path: string, mtimeMs: number): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
	utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
	return path;
}

describe("parseAgents", () => {
	test("keeps the agents with an id and a known status, and defaults what the host leaves out", () => {
		expect(
			parseAgents([
				{ id: "main", kind: "main", displayName: "main", status: "running", createdAt: 5 },
				{ id: "s1", kind: "task", displayName: "explore", parentId: "main", status: "parked", createdAt: 9 },
				{ id: "s2", status: "idle" },
				{ id: "s3", status: "sleeping" },
				{ status: "idle" },
				"junk",
			]),
		).toEqual([
			{ id: "main", type: "main", isMain: true, parentId: null, status: "running", createdAt: 5 },
			{ id: "s1", type: "explore", isMain: false, parentId: "main", status: "parked", createdAt: 9 },
			{ id: "s2", type: "agent", isMain: false, parentId: null, status: "idle", createdAt: 0 },
		]);
		expect(parseAgents(undefined)).toEqual([]);
	});
});

describe("parseSubagentFrame", () => {
	test("a lifecycle frame names the subagent, its type, status, description, and file", () => {
		expect(
			parseSubagentFrame(SUBAGENT_LIFECYCLE, { id: "s1", agent: "explore", status: "started", description: "  find\nthe   bug ", sessionFile: "/tmp/s1.jsonl" }),
		).toEqual({ id: "s1", kind: "explore", status: "running", activity: "find the bug", sessionFile: "/tmp/s1.jsonl" });
		expect(parseSubagentFrame(SUBAGENT_LIFECYCLE, { id: "s1", status: "failed" })).toEqual({ id: "s1", status: "aborted" });
	});

	test("a progress frame reads its status and activity from the progress record, the most specific intent first", () => {
		const progress = { id: "s1", status: "completed", currentToolIntent: "reading", lastIntent: "planning", task: "the task" };
		expect(parseSubagentFrame(SUBAGENT_PROGRESS, { agent: "task", assignment: "assigned", progress })).toEqual({
			id: "s1",
			kind: "task",
			status: "idle",
			activity: "reading",
		});
		expect(parseSubagentFrame(SUBAGENT_PROGRESS, { assignment: "assigned", progress: { id: "s1", task: "the task" } })?.activity).toBe("assigned");
		expect(parseSubagentFrame(SUBAGENT_PROGRESS, { progress: { id: "s1" } })).toEqual({ id: "s1" });
	});

	test("a payload that names no subagent, or arrives on another channel, is ignored", () => {
		expect(parseSubagentFrame(SUBAGENT_LIFECYCLE, { status: "started" })).toBeNull();
		expect(parseSubagentFrame(SUBAGENT_PROGRESS, { progress: { status: "running" } })).toBeNull();
		expect(parseSubagentFrame(SUBAGENT_LIFECYCLE, "junk")).toBeNull();
		expect(parseSubagentFrame("task:other", { id: "s1", description: "x" })).toBeNull();
	});
});

describe("SubagentFiles", () => {
	test("a subagent's transcript is expected under its session's artifacts directory, inside its ancestors' directories", () => {
		const { sessionFile, files } = setup();
		const root = sessionFile.replace(/\.jsonl$/, "");
		const agents = [agent("0-Parent"), agent("1-Child", { parentId: "0-Parent" }), agent("2-Grand", { parentId: "1-Child" })];
		expect(files.pathOf(sessionFile, "0-Parent", agents)).toBe(join(root, "0-Parent.jsonl"));
		expect(files.pathOf(sessionFile, "1-Child", agents)).toBe(join(root, "0-Parent", "1-Child.jsonl"));
		expect(files.pathOf(sessionFile, "2-Grand", agents)).toBe(join(root, "0-Parent", "1-Child", "2-Grand.jsonl"));
	});

	test("an agent the host does not list as a subagent has no transcript", () => {
		const { sessionFile, files } = setup();
		const agents = [agent("main", { isMain: true }), agent("s1")];
		expect(files.pathOf(sessionFile, "ghost", agents)).toBeNull();
		expect(files.pathOf(sessionFile, "main", agents)).toBeNull();
	});

	test("when the expected file is missing, the newest transcript written since the subagent registered is used", async () => {
		const { project, sessionFile, files, nextFind } = setup();
		const expected = join(sessionFile.replace(/\.jsonl$/, ""), "s1.jsonl");
		transcript(join(project, "2026-09-01T00-00-00_old", "s1.jsonl"), 500);
		const newest = transcript(join(project, "2026-09-02T00-00-00_mid", "s1.jsonl"), 3000);
		transcript(join(project, "2026-09-03T00-00-00_other", "s1.jsonl"), 2000);
		transcript(join(project, "2026-09-04T00-00-00_other", "s2.jsonl"), 9000);
		const agents = [agent("s1", { createdAt: 1000 })];

		const find = nextFind();
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(expected);
		await find;

		expect(files.pathOf(sessionFile, "s1", agents)).toBe(newest);
	});

	test("a transcript older than the subagent's registration is never taken for it", async () => {
		const { project, sessionFile, files, finds, nextFind } = setup();
		const expected = join(sessionFile.replace(/\.jsonl$/, ""), "s1.jsonl");
		transcript(join(project, "2026-09-01T00-00-00_old", "s1.jsonl"), 500);
		// A second agent, whose find settles after the first search has had its chance.
		const later = transcript(join(project, "2026-09-02T00-00-00_old", "s2.jsonl"), 5000);
		const agents = [agent("s1", { createdAt: 1000 }), agent("s2", { createdAt: 1000 })];

		const find = nextFind();
		files.pathOf(sessionFile, "s1", agents);
		files.pathOf(sessionFile, "s2", agents);
		await find;

		expect(finds()).toBe(1);
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(expected);
		expect(files.pathOf(sessionFile, "s2", agents)).toBe(later);
	});

	test("a transcript that exists where omp writes it is used without a search", async () => {
		const { project, sessionFile, files, finds, nextFind } = setup();
		const present = transcript(join(sessionFile.replace(/\.jsonl$/, ""), "s1.jsonl"), 2000);
		transcript(join(project, "2026-09-01T00-00-00_other", "s1.jsonl"), 9000);
		transcript(join(project, "2026-09-01T00-00-00_other", "s2.jsonl"), 9000);
		const agents = [agent("s1", { createdAt: 1000 }), agent("s2", { createdAt: 1000 })];

		const find = nextFind();
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(present);
		files.pathOf(sessionFile, "s2", agents);
		await find;

		// Only s2's search found anything.
		expect(finds()).toBe(1);
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(present);
	});

	test("a found transcript stays while its subagent is listed", async () => {
		const { project, sessionFile, files, nextFind } = setup();
		const away = transcript(join(project, "2026-09-01T00-00-00_old", "s1.jsonl"), 3000);
		const agents = [agent("s1", { createdAt: 1000 })];

		const find = nextFind();
		files.pathOf(sessionFile, "s1", agents);
		await find;

		files.update(agents, [agent("s1", { createdAt: 1000, status: "idle" })]);
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(away);
	});

	test("a subagent that leaves the registry and returns is searched for again", async () => {
		const { project, sessionFile, files, nextFind } = setup();
		const away = transcript(join(project, "2026-09-01T00-00-00_old", "s1.jsonl"), 3000);
		const agents = [agent("s1", { createdAt: 1000 })];

		let find = nextFind();
		files.pathOf(sessionFile, "s1", agents);
		await find;
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(away);

		files.update(agents, []);
		const moved = transcript(join(project, "2026-09-02T00-00-00_new", "s1.jsonl"), 4000);
		find = nextFind();
		files.pathOf(sessionFile, "s1", agents);
		await find;
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(moved);
	});

	test("a registry change recomputes where a subagent's file is expected", () => {
		const { sessionFile, files } = setup();
		const root = sessionFile.replace(/\.jsonl$/, "");
		const before = [agent("s1"), agent("s2")];
		expect(files.pathOf(sessionFile, "s2", before)).toBe(join(root, "s2.jsonl"));

		const after = [agent("s1"), agent("s2", { parentId: "s1" })];
		files.update(before, after);
		expect(files.pathOf(sessionFile, "s2", after)).toBe(join(root, "s1", "s2.jsonl"));
	});

	test("the expected path follows the session file when the host moves to another session", () => {
		const { project, sessionFile, files } = setup();
		const next = join(project, "2026-10-02T12-00-00_bbbb.jsonl");
		const agents = [agent("s1")];
		expect(files.pathOf(sessionFile, "s1", agents)).toBe(join(sessionFile.replace(/\.jsonl$/, ""), "s1.jsonl"));
		expect(files.pathOf(next, "s1", agents)).toBe(join(next.replace(/\.jsonl$/, ""), "s1.jsonl"));
	});
});
