import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptRefused } from "../live-session";
import type { BotId } from "../shared/bots";
import { type HostStatus, newSessionRequest, type StartRequest } from "../shared/sessions";
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

/** One dashboard session `i1`, whose status the test sets, what it was sent, and the first note it showed. */
function setup() {
	const sent: string[] = [];
	const noted = Promise.withResolvers<string>();
	const session = {
		status: "working" as HostStatus,
		refusal: null as string | null,
		async prompt(agentId: string | null, text: string, images: unknown[], delivery: string) {
			if (session.refusal) throw new PromptRefused(session.refusal);
			sent.push(`${agentId} ${text} ${images.length} ${delivery}`);
		},
	};
	const moves = new SessionMoves({
		session: instanceId => (instanceId === "i1" ? session : undefined),
		isBot: request => request.kind === "new" && request.bot !== null,
		note: (instanceId, text) => noted.resolve(`${instanceId}: ${text}`),
	});
	const tool = moves.join(newSessionRequest("/tmp", "Hi")).rpc.tools[0]!;
	const call = (toolCallId: string, path: string) => tool.execute({ path }, { toolCallId, signal: new AbortController().signal });
	/** omp's end of call `toolCallId` in session `i1`. */
	const ended = (toolCallId: string, isError = false) => moves.heard("i1", { type: "tool_execution_end", toolCallId, toolName: "move_session", isError });
	/** Session `i1` ends a turn and shows `status` right after, as a dashboard session does, then the deferred move runs. */
	const turnEnds = async (status: HostStatus) => {
		moves.turnEnded("i1");
		session.status = status;
		await Promise.resolve();
	};
	return { moves, session, sent, noted: noted.promise, call, ended, turnEnds };
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

	test("moves the session once, when the turn that called it ends", async () => {
		const { sent, call, ended, turnEnds } = setup();
		const dir = tempDir();
		expect(await call("c1", dir)).toBe(`When this turn ends, the dashboard moves this session to ${dir} and reloads its context files. End your turn now; do not work in ${dir} before the move.`);
		ended("c1");
		await turnEnds("idle");
		expect(sent).toEqual([`null /move ${dir} 0 steer`]);
		await turnEnds("idle");
		expect(sent).toEqual([`null /move ${dir} 0 steer`]);
	});

	test("the last call of a turn names where it moves", async () => {
		const { sent, call, ended, turnEnds } = setup();
		const [first, second] = [tempDir(), tempDir()];
		await call("c1", first);
		ended("c1");
		await call("c2", second);
		ended("c2");
		await turnEnds("idle");
		expect(sent).toEqual([`null /move ${second} 0 steer`]);
	});

	test("a path that is no directory errors to the model and queues nothing", async () => {
		const { sent, call, ended, turnEnds } = setup();
		const file = join(tempDir(), "notes.txt");
		writeFileSync(file, "");
		await expect(call("c1", file)).rejects.toThrow(`Not a directory: ${file}`);
		await expect(call("c2", "relative/dir")).rejects.toThrow("path must be absolute or start with ~.");
		ended("c1", true);
		ended("c2", true);
		await turnEnds("idle");
		expect(sent).toEqual([]);
	});

	test("a session busy again at its turn's end moves at the next one", async () => {
		const { sent, call, ended, turnEnds } = setup();
		const dir = tempDir();
		await call("c1", dir);
		ended("c1");
		await turnEnds("working");
		expect(sent).toEqual([]);
		await turnEnds("idle");
		expect(sent).toEqual([`null /move ${dir} 0 steer`]);
	});

	test("a session that exits forgets its move", async () => {
		const { moves, sent, call, ended, turnEnds } = setup();
		await call("c1", tempDir());
		ended("c1");
		moves.exited("i1");
		await turnEnds("idle");
		expect(sent).toEqual([]);
	});

	test("a move the session refuses shows in its conversation", async () => {
		const { session, noted, call, ended, turnEnds } = setup();
		const dir = tempDir();
		await call("c1", dir);
		ended("c1");
		session.refusal = "Local slash commands are blocked in a replay.";
		await turnEnds("idle");
		expect(await noted).toBe(`i1: Could not move to ${dir}: Local slash commands are blocked in a replay.`);
	});
});
