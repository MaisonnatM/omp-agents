import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotId } from "../shared/bots";
import { newSessionRequest, type StartRequest } from "../shared/sessions";
import { SessionMoves } from "./session-moves";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-session-moves-"));
	dirs.push(dir);
	return dir;
}

/** One running dashboard session `i1`, and the moves it was handed for its turn's end. */
function setup() {
	const moved: string[] = [];
	const moves = new SessionMoves({
		session: instanceId => (instanceId === "i1" ? { moveAfterTurn: dir => void moved.push(dir) } : undefined),
		isBot: request => request.kind === "new" && request.bot !== null,
	});
	const tool = moves.join(newSessionRequest("/tmp", "Hi")).rpc.tools[0]!;
	/** omp starts call `toolCallId` in session `instanceId`, and the tool runs it. */
	const call = (toolCallId: string, path: string, instanceId = "i1") => {
		moves.heard(instanceId, { type: "tool_execution_start", toolCallId, toolName: "move_session" });
		return tool.execute({ path }, { toolCallId, signal: new AbortController().signal });
	};
	/** omp's end of call `toolCallId` in session `instanceId`. */
	const ended = (toolCallId: string, isError = false, instanceId = "i1") => moves.heard(instanceId, { type: "tool_execution_end", toolCallId, toolName: "move_session", isError });
	return { moves, moved, call, ended };
}

describe("the move_session tool", () => {
	test("every dashboard start gets it but a Bot's conversation", () => {
		const { moves } = setup();
		const toolsOf = (request: StartRequest) => moves.join(request).rpc.tools.map(tool => tool.name);
		expect(toolsOf(newSessionRequest("/tmp", "Hi"))).toEqual(["move_session"]);
		expect(toolsOf({ kind: "resume", sessionId: "s1" })).toEqual(["move_session"]);
		expect(toolsOf({ kind: "fork", view: { kind: "past", sessionId: "s1" }, entryId: "e1" })).toEqual(["move_session"]);
		expect(toolsOf(newSessionRequest("/tmp", "Hi", { bot: "scout" as BotId }))).toEqual([]);
	});

	test("a call's end hands the session that reported it the move for its turn's end, once", async () => {
		const { moved, call, ended } = setup();
		const dir = tempDir();
		expect(await call("c1", dir)).toBe(`When this turn ends, the dashboard moves this session to ${dir} and reloads its context files. End your turn now; do not work in ${dir} before the move.`);
		expect(moved).toEqual([]);
		ended("c1");
		ended("c1");
		expect(moved).toEqual([dir]);
	});

	test("each call of a turn hands its directory over in turn, so the last one names where it moves", async () => {
		const { moved, call, ended } = setup();
		const [first, second] = [tempDir(), tempDir()];
		await call("c1", first);
		ended("c1");
		await call("c2", second);
		ended("c2");
		expect(moved).toEqual([first, second]);
	});

	test("a path that is no directory errors to the model and moves nothing", async () => {
		const { moved, call, ended } = setup();
		const file = join(tempDir(), "notes.txt");
		writeFileSync(file, "");
		await expect(call("c1", file)).rejects.toThrow(`Not a directory: ${file}`);
		await expect(call("c2", "relative/dir")).rejects.toThrow("path must be absolute or start with ~.");
		ended("c1", true);
		ended("c2", true);
		expect(moved).toEqual([]);
	});

	test("a call that ends in a session no longer running moves nothing", async () => {
		const { moved, call, ended } = setup();
		await call("c1", tempDir(), "gone");
		ended("c1", false, "gone");
		expect(moved).toEqual([]);
	});

	test("a call its turn or its session cut off before its end is forgotten", async () => {
		const { moves, moved, call, ended } = setup();
		await call("c1", tempDir());
		await call("c2", tempDir(), "i2");
		moves.heard("i1", { type: "agent_end", messages: [] });
		ended("c1");
		expect(moved).toEqual([]);

		const dir = tempDir();
		await call("c3", dir);
		moves.exited("i2");
		ended("c3");
		ended("c2", false, "i2");
		expect(moved).toEqual([dir]);
	});
});
