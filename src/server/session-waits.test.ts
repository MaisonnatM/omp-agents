import { afterEach, describe, expect, jest, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { BotId } from "../shared/bots";
import { type AgentRow, type HostStatus, newSessionRequest, type RosterHost, type StartRequest, type UserRequest } from "../shared/sessions";
import { SessionWaits } from "./session-waits";

afterEach(() => {
	jest.useRealTimers();
});

const host = (instanceId: string, status: HostStatus, { sessionName = `Session ${instanceId}`, requests = [], agents = [] }: { sessionName?: string | null; requests?: UserRequest[]; agents?: AgentRow[] } = {}) =>
	fromPartial<RosterHost>({ instanceId, sessionId: `s-${instanceId}`, sessionName, status, requests, agents, turnWaits: false });
const subagent = (status: AgentRow["status"]) => fromPartial<AgentRow>({ status });

/** Whether `promise` has settled yet: its value, its error's message, or `"pending"`. */
const state = (promise: Promise<string>) =>
	Promise.race([promise.catch((err: Error) => `error: ${err.message}`), Promise.resolve("pending")]);

/** Live sessions `i1`, which calls the tool, and `i2`, building; `replies` are their session files' last replies, by session id. */
function setup() {
	let hosts = [host("i1", "working"), host("i2", "working", { sessionName: "Build the importer" })];
	const replies: Record<string, string> = { "s-i2": "Pushed feat/importer; tests pass." };
	const waits = new SessionWaits({ hosts: () => hosts, reply: sessionId => replies[sessionId] ?? null, isBot: request => request.kind === "new" && request.bot !== null });
	/** Session `caller`'s turn calls the tool as call `toolCallId`. */
	const call = (toolCallId: string, session: string, { caller = "i1", minutes = null, signal = new AbortController().signal }: { caller?: string; minutes?: number | null; signal?: AbortSignal } = {}) =>
		waits.join(newSessionRequest("/tmp", "Hi"), caller).rpc.tools[0]!.execute({ session, timeout_minutes: minutes }, { toolCallId, signal });
	/** The live sessions' rows change to `rows`, as a roster update reports. */
	const rows = (...rows: RosterHost[]) => {
		hosts = rows;
		waits.check();
	};
	return { waits, call, rows };
}

describe("the wait_for_session tool", () => {
	test("every dashboard start gets it but a Bot's conversation", () => {
		const { waits } = setup();
		const toolsOf = (request: StartRequest) => waits.join(request, "i1").rpc.tools.map(tool => tool.name);
		expect(toolsOf(newSessionRequest("/tmp", "Hi"))).toEqual(["wait_for_session"]);
		expect(toolsOf({ kind: "resume", sessionId: "s1" })).toEqual(["wait_for_session"]);
		expect(toolsOf(newSessionRequest("/tmp", "Hi", { bot: "scout" as BotId }))).toEqual([]);
	});

	test("answers once the session's turn ends, with its last reply", async () => {
		const { call, rows } = setup();
		const wait = call("c1", "s-i2");
		expect(await state(wait)).toBe("pending");
		rows(host("i1", "working"), host("i2", "idle", { sessionName: "Build the importer" }));
		expect(await wait).toBe('"Build the importer" (id s-i2) ended its turn and waits for the user.\n\nIts last reply:\n\nPushed feat/importer; tests pass.');
	});

	test("finds the session by its exact title too, and answers at once when it already waits for the user", async () => {
		const { call, rows } = setup();
		rows(host("i1", "working"), host("i2", "idle", { sessionName: "Build the importer" }));
		expect(await call("c1", "build the importer")).toStartWith('"Build the importer" (id s-i2) ended its turn and waits for the user.');
	});

	test("answers when the session asks the user a question, with the question", async () => {
		const { call, rows } = setup();
		const wait = call("c1", "s-i2");
		const ask: UserRequest = { id: "r1", title: "Which branch?", deadline: null, kind: "ask", questions: [fromPartial({ question: "Which branch should I push?" })] };
		rows(host("i1", "working"), host("i2", "needs-input", { sessionName: "Build the importer", requests: [ask] }));
		expect(await wait).toBe(
			'"Build the importer" (id s-i2) waits on the user\'s answer, which the user gives in the dashboard; call wait_for_session again to wait until it stops again.\n\nIts question:\n\nWhich branch should I push?\n\nIts last reply:\n\nPushed feat/importer; tests pass.',
		);
	});

	test("keeps waiting while the session only waits on a subagent that runs, and answers once it stops", async () => {
		const { call, rows } = setup();
		const wait = call("c1", "s-i2");
		rows(host("i1", "working"), host("i2", "idle", { sessionName: "Build the importer", agents: [subagent("running")] }));
		expect(await state(wait)).toBe("pending");
		rows(host("i1", "working"), host("i2", "idle", { sessionName: "Build the importer", agents: [subagent("idle")] }));
		expect(await wait).toStartWith('"Build the importer" (id s-i2) ended its turn');
	});

	test("answers when the session no longer runs, with the last reply its file holds", async () => {
		const { call, rows } = setup();
		const wait = call("c1", "s-i2");
		rows(host("i1", "working"));
		expect(await wait).toBe('"Build the importer" (id s-i2) no longer runs: it ended or its omp exited.\n\nIts last reply:\n\nPushed feat/importer; tests pass.');
	});

	test("stops waiting after its time limit", async () => {
		jest.useFakeTimers();
		const { call } = setup();
		const wait = call("c1", "s-i2", { minutes: 1 });
		jest.advanceTimersByTime(59_000);
		expect(await state(wait)).toBe("pending");
		jest.advanceTimersByTime(1_000);
		expect(await wait).toBe('Stopped waiting after 1 minutes: "Build the importer" (id s-i2) has not stopped for the user yet. Call wait_for_session again to keep waiting.');
	});

	test("refuses a session that is not running, a title two sessions share, and a time limit out of range", async () => {
		const { call, rows } = setup();
		await expect(call("c1", "s-gone")).rejects.toThrow('No running session has the id or title "s-gone"');
		await expect(call("c2", "s-i2", { minutes: 241 })).rejects.toThrow("timeout_minutes must be above 0 and at most 240");
		rows(host("i1", "working"), host("i2", "working", { sessionName: "Fix" }), host("i3", "working", { sessionName: "Fix" }));
		await expect(call("c3", "Fix")).rejects.toThrow('2 running sessions are titled "Fix"; pass the session\'s id instead.');
	});

	test("refuses to wait on its own session", async () => {
		const { call } = setup();
		await expect(call("c1", "s-i1")).rejects.toThrow("A session cannot wait on itself.");
	});

	test("stops when the calling turn is interrupted or its session exits", async () => {
		const { waits, call } = setup();
		const interrupt = new AbortController();
		const interrupted = call("c1", "s-i2", { signal: interrupt.signal });
		interrupt.abort();
		await expect(interrupted).rejects.toThrow("The wait was stopped.");
		const orphaned = call("c2", "s-i2");
		waits.exited("i1");
		await expect(orphaned).rejects.toThrow("This session ended.");
	});
});
