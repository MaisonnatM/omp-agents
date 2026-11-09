import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotId } from "../shared/bots";
import type { TrustAsk } from "../shared/project-trust";
import { newSessionRequest, type StartRequest } from "../shared/sessions";
import { UntrustedProjectError, untrustedText } from "./project-trust-file";
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

/** One running dashboard session `i1`, and the moves it was handed for its turn's end; `untrusted` is what the census finds in a directory. */
function setup(untrusted: (dir: string) => TrustAsk | null = () => null) {
	const moved: string[] = [];
	const moves = new SessionMoves({
		session: instanceId => (instanceId === "i1" ? { moveAfterTurn: dir => void moved.push(dir) } : undefined),
		staysPut: request => request.kind === "new" && request.bot !== null,
		admit: async dir => {
			const ask = untrusted(dir);
			if (ask) throw new UntrustedProjectError(ask);
		},
	});
	/** Session `caller`'s turn calls the tool as call `toolCallId`. */
	const call = (toolCallId: string, path: string, { caller = "i1", signal = new AbortController().signal }: { caller?: string; signal?: AbortSignal } = {}) =>
		moves.join(newSessionRequest("/tmp", "Hi"), caller).rpc.tools[0]!.execute({ path }, { toolCallId, signal });
	/** omp's end of call `toolCallId`. */
	const ended = (toolCallId: string, isError = false) => moves.heard({ type: "tool_execution_end", toolCallId, toolName: "move_session", isError });
	return { moves, moved, call, ended };
}

describe("the move_session tool", () => {
	test("every dashboard start gets it but a Bot's conversation", () => {
		const { moves } = setup();
		const toolsOf = (request: StartRequest) => moves.join(request, "i1").rpc.tools.map(tool => tool.name);
		expect(toolsOf(newSessionRequest("/tmp", "Hi"))).toEqual(["move_session"]);
		expect(toolsOf({ kind: "resume", sessionId: "s1" })).toEqual(["move_session"]);
		expect(toolsOf({ kind: "fork", view: { kind: "past", sessionId: "s1" }, entryId: "e1" })).toEqual(["move_session"]);
		expect(toolsOf(newSessionRequest("/tmp", "Hi", { bot: "scout" as BotId }))).toEqual([]);
	});

	test("a call's end hands the session that called it the move for its turn's end, once", async () => {
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

	test("a directory whose agent code is untrusted errors to the model with the trust message and moves nothing", async () => {
		const dir = tempDir();
		const ask: TrustAsk = { root: dir, rootDisplay: dir, code: [{ kind: "mcp-server", id: "mcp:db", name: "db", hash: "h", change: "new" }] };
		const { moved, call, ended } = setup(at => (at === dir ? ask : null));
		await expect(call("c1", dir)).rejects.toThrow(untrustedText(ask));
		ended("c1", true);
		expect(moved).toEqual([]);
	});

	test("a call that ends in a session no longer running moves nothing", async () => {
		const { moved, call, ended } = setup();
		await call("c1", tempDir(), { caller: "gone" });
		ended("c1");
		expect(moved).toEqual([]);
	});

	test("a call whose session exited before its end is forgotten", async () => {
		const { moves, moved, call, ended } = setup();
		await call("c1", tempDir());
		moves.exited("i1");
		ended("c1");
		expect(moved).toEqual([]);
		const dir = tempDir();
		await call("c2", dir);
		ended("c2");
		expect(moved).toEqual([dir]);
	});

	test("a call its turn cut off while the directory was checked errors to the model, and its end moves nothing", async () => {
		const { moved, call, ended } = setup();
		const turn = new AbortController();
		const result = call("c1", tempDir(), { signal: turn.signal });
		turn.abort();
		await expect(result).rejects.toThrow("This turn ended before the move was taken; nothing moves.");
		ended("c1");
		expect(moved).toEqual([]);
	});
});
