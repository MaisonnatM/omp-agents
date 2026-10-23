import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardSession, type DashboardUpdate } from "./dashboard-session";
import type { Frame } from "./omp/collab";
import * as rpc from "./omp/rpc";
import { PLAIN_LAUNCH, type RpcChild, type RpcClient, type RpcState } from "./omp/rpc";
import { errorText } from "./json";
import { PromptRefused } from "./live-session";
import { LiveSessions } from "./server/live-sessions";
import { endSession } from "./server/session-end";
import { RequestLedger } from "./server/request-ledger";
import { createClientHandler, type SocketEnv } from "./server/socket";
import type { Socket } from "./server/views";
import type { ServerMsg } from "./shared/protocol";
import * as replayLaunch from "./omp/replay-launch";
import type { PreparedReplay } from "./replay";

const STATE: RpcState = { sessionId: "session-1", fastModeEnabled: false, fastModeActive: false, isStreaming: false, isCompacting: false, hasPendingAsyncWork: false, queuedMessages: { steering: [], followUp: [] } };

/** An omp RPC client whose methods answer at once, records what the session sends omp, and lets a test play omp's events. */
class FakeClient implements RpcClient {
	calls: string[] = [];
	#listeners: ((event: Frame) => void)[] = [];
	#resultListeners: ((result: { id?: string }) => void)[] = [];
	#requests = 0;

	start = async (): Promise<void> => {};
	stop: RpcClient["stop"] = async () => {};
	getState: RpcClient["getState"] = async () => STATE;
	prompt: RpcClient["prompt"] = async text => {
		this.calls.push(`prompt ${text}`);
		return `req_${++this.#requests}`;
	};
	onPromptResult: RpcClient["onPromptResult"] = listener => {
		this.#resultListeners.push(listener);
		return () => {};
	};
	removeQueuedMessage: RpcClient["removeQueuedMessage"] = async () => ({ removed: true });
	promoteQueuedMessage = async () => ({ promoted: true });
	abort = async (): Promise<void> => {};
	abortAndRestoreQueue: RpcClient["abortAndRestoreQueue"] = async () => ({ steering: [], followUp: [] });
	getAvailableModels = async () => [];
	setModel: RpcClient["setModel"] = async (provider, id) => ({ provider, id });
	getAvailableThinkingLevels = async () => ["off", "low"];
	setThinkingLevel = async (): Promise<void> => {};
	setFastMode: RpcClient["setFastMode"] = async enabled => {
		this.calls.push(`fast ${enabled}`);
		return { enabled, active: enabled };
	};
	setSubagentSubscription = async () => "progress";
	getSubagents: RpcClient["getSubagents"] = async () => [];
	switchSession = async () => ({ cancelled: false });
	branch: RpcClient["branch"] = async () => ({ text: "", cancelled: false });
	newSession = async () => ({ cancelled: false });
	onSessionEvent = (listener: (event: Frame) => void) => {
		this.#listeners.push(listener);
		return () => {};
	};
	onSubagentLifecycle: RpcClient["onSubagentLifecycle"] = () => () => {};
	onSubagentProgress = () => () => {};
	steerSubagent = async (): Promise<void> => {};
	cancelSubagent = async () => true;
	setCustomTools: RpcClient["setCustomTools"] = async tools => {
		this.calls.push(`tools ${tools.map(tool => tool.name).join(",")}`);
		return tools.map(tool => tool.name);
	};
	bash: RpcClient["bash"] = async command => {
		this.calls.push(`bash ${command}`);
	};

	/** A session event as omp's RPC client hands it to the session. */
	fire(event: Record<string, unknown>): void {
		for (const listener of this.#listeners) listener({ t: "event", ...event });
	}

	settlePrompt(id: string): void {
		for (const listener of this.#resultListeners) listener({ id });
	}
}

/** Lets every promise reaction that is already queued, and the ones it queues in turn, run. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** An omp process that never exits, driven through `client`; `startRpc` hands `onFrame` to the session. */
function fakeOmp(client: FakeClient) {
	const child: RpcChild = { client, pid: 4242, exited: Promise.withResolvers<"detach" | "exit">().promise, write: () => {}, meta: { startedAt: 1, cwd: "/tmp/project" }, detach: () => {} };
	const omp = { onFrame: (_frame: Record<string, unknown>) => {} };
	spyOn(rpc, "startRpc").mockImplementation(async (_instanceId, _cwd, onFrame) => {
		omp.onFrame = onFrame;
		return child;
	});
	return omp;
}

/** Start a session on a fake omp, and collect what it reports. */
async function startSession(model: { provider: string; id: string } | null = null) {
	const client = new FakeClient();
	fakeOmp(client);
	const updates: DashboardUpdate[] = [];
	const session = await DashboardSession.start("inst-1", "/tmp/project", model, null, PLAIN_LAUNCH, update => updates.push(update));
	return { session, client, updates, rosters: () => updates.filter(update => update.kind === "roster").length };
}

afterEach(() => {
	mock.restore();
});

describe("DashboardSession state refresh", () => {
	test("a change that arrives while omp's state is being read runs one more read, so the last change lands", async () => {
		const { session, client } = await startSession();
		const reads: PromiseWithResolvers<RpcState>[] = [];
		client.getState = () => {
			const read = Promise.withResolvers<RpcState>();
			reads.push(read);
			return read.promise;
		};

		client.fire({ type: "turn_end" });
		await settle();
		expect(reads).toHaveLength(1);
		client.fire({ type: "model_changed" });
		client.fire({ type: "turn_end" });
		reads[0]?.resolve({ ...STATE, sessionName: "first" });
		await settle();
		expect(reads).toHaveLength(2);
		expect(session.sessionName).toBe("first");

		reads[1]?.resolve({ ...STATE, sessionName: "second" });
		await settle();
		expect(reads).toHaveLength(2);
		expect(session.sessionName).toBe("second");
	});

	test("two quick model switches keep the spinner until the last result and a queued refresh sees that result", async () => {
		const { session, client } = await startSession();
		const first = Promise.withResolvers<void>();
		const second = Promise.withResolvers<void>();
		let model = "initial";
		const calls: string[] = [];
		client.setModel = async (_provider, id) => {
			calls.push(id);
			await (id === "first" ? first.promise : second.promise);
			model = id;
			return { provider: "p", id };
		};
		client.getState = async () => ({ ...STATE, sessionName: model });

		const one = session.setModel({ provider: "p", id: "first" }, null);
		const two = session.setModel({ provider: "p", id: "second" }, null);
		client.fire({ type: "model_changed" });
		await settle();
		expect(session.switching).toBe(true);
		expect(calls).toEqual(["first"]);

		first.resolve();
		await settle();
		expect(session.switching).toBe(true);
		expect(calls).toEqual(["first", "second"]);
		second.resolve();
		await Promise.all([one, two]);
		await settle();
		expect(session.switching).toBe(false);
		expect(session.sessionName).toBe("second");
	});

	test("a model switch omp refuses rejects with its error once the spinner is off, so the page's request settles with it", async () => {
		const { session, client } = await startSession();
		client.setModel = async () => {
			throw new Error("no such model");
		};

		const switched = session.setModel({ provider: "p", id: "missing" }, null);
		expect(session.switching).toBe(true);
		await expect(switched).rejects.toThrow("no such model");
		expect(session.switching).toBe(false);
	});

	test("after a /move the session keeps omp's other state, then follows the new file once omp writes it, into the directory its header records", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-move-"));
		try {
			const client = new FakeClient();
			fakeOmp(client);
			const switched = Promise.withResolvers<void>();
			const refreshed = Promise.withResolvers<void>();
			const session = await DashboardSession.start("inst-1", "/tmp/project", null, null, PLAIN_LAUNCH, update => {
				if (update.kind === "switched") switched.resolve();
				if (update.kind === "roster") refreshed.resolve();
			});
			const file = join(dir, "moved.jsonl");
			client.getState = async () => ({ ...STATE, sessionFile: file, sessionName: "moved" });

			client.fire({ type: "turn_end" });
			await refreshed.promise;
			expect(session.sessionName).toBe("moved");
			expect(session.sessionFile).toBeNull();
			expect(session.cwd).toBe("/tmp/project");

			writeFileSync(file, `${JSON.stringify({ type: "session", id: "session-1", cwd: dir })}\n`);
			client.fire({ type: "turn_end" });
			await switched.promise;
			expect(session.sessionFile).toBe(file);
			expect(session.cwd).toBe(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("DashboardSession turns", () => {
	test("an untitled session asks omp for a title once, through the turn gate, however many prompts follow", async () => {
		const { client } = await startSession();
		client.fire({ type: "message_end", message: { role: "user" } });
		client.fire({ type: "message_end", message: { role: "user" } });
		await settle();
		expect(client.calls).toEqual(["prompt /rename"]);
	});

	test("a prompt the dashboard sent in the user's place does not title the session", async () => {
		const { client } = await startSession();
		client.fire({ type: "message_end", message: { role: "user", content: "[omp-agents] Project update.\n- w1 stopped." } });
		await settle();
		expect(client.calls).toEqual([]);
		client.fire({ type: "message_end", message: { role: "user", content: "Migrate billing." } });
		await settle();
		expect(client.calls).toEqual(["prompt /rename"]);
	});

	test("an agent_end that is not terminal hands over to a queued follow-up, so the session keeps working", async () => {
		const { session, client } = await startSession();
		client.fire({ type: "agent_start" });
		expect(session.status).toBe("working");

		client.fire({ type: "agent_end", isTerminal: false });
		expect(session.status).toBe("working");

		client.fire({ type: "agent_end", isTerminal: true });
		expect(session.status).toBe("idle");
	});

	test("a terminal agent_end reports the turn's last reply once, without its suggested prompts", async () => {
		const { client, updates } = await startSession();
		const ended = () => updates.filter(update => update.kind === "turn-ended");
		const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
		client.fire({ type: "agent_start" });
		client.fire({ type: "agent_end", isTerminal: false, messages: [assistant("first")] });
		expect(ended()).toEqual([]);
		client.fire({
			type: "agent_end",
			messages: [assistant("Done: ok\n\nSuggestions:\n1. Ship it"), { role: "assistant", content: [{ type: "toolCall", id: "t1" }] }, { role: "toolResult", content: [] }],
		});
		expect(ended()).toEqual([{ kind: "turn-ended", reply: "Done: ok", failure: null }]);
		client.fire({ type: "agent_end", messages: [] });
		expect(ended().at(-1)).toEqual({ kind: "turn-ended", reply: null, failure: null });
	});

	test("a terminal agent_end whose last message failed on a usage limit or a dropped connection reports how; a handover does not", async () => {
		const { client, updates } = await startSession();
		const limited = {
			role: "assistant",
			content: [],
			stopReason: "error",
			provider: "opencode-go",
			errorStatus: 429,
			errorMessage: "429 Go usage limit exceeded retry-after-ms=200813000\nGo usage limit exceeded (type=GoUsageLimitError)",
		};
		client.fire({ type: "agent_start" });
		client.fire({ type: "agent_end", isTerminal: false, messages: [limited] });
		client.fire({ type: "agent_end", messages: [limited] });
		client.fire({ type: "agent_start" });
		client.fire({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "error", provider: "openai-codex", errorMessage: "Couldn't reach chatgpt.com (getaddrinfo ENOTFOUND). Check the URL, your network, or proxy." }] });
		expect(updates.filter(update => update.kind === "turn-ended")).toEqual([
			{ kind: "turn-ended", reply: null, failure: { kind: "usage-limit", provider: "opencode-go", retryAfterMs: 200_813_000 } },
			{ kind: "turn-ended", reply: null, failure: { kind: "transient", provider: "openai-codex" } },
		]);
	});

	test("a turn's start is reported after the roster update that shows it working, and its end before the one that shows it idle", async () => {
		const { session, client, updates } = await startSession();
		const order = () => updates.map(update => update.kind).filter(kind => kind === "turn-started" || kind === "turn-ended" || kind === "roster");
		const from = order().length;
		client.fire({ type: "agent_start" });
		expect([order().slice(from), session.status]).toEqual([["roster", "turn-started"], "working"]);
		client.fire({ type: "agent_end", messages: [] });
		expect([order().slice(from + 2, from + 4), session.status]).toEqual([["turn-ended", "roster"], "idle"]);
	});

	test("a queue_update replaces both queues, and one with a malformed queue changes nothing", async () => {
		const { session, client, rosters } = await startSession();
		const before = rosters();

		client.fire({ type: "queue_update", steering: ["a"], followUp: ["b", "c"] });
		expect(session.queue).toEqual({ steering: ["a"], followUp: ["b", "c"] });
		expect(rosters()).toBe(before + 1);

		client.fire({ type: "queue_update", steering: [], followUp: ["d"] });
		expect(session.queue).toEqual({ steering: [], followUp: ["d"] });

		client.fire({ type: "queue_update", steering: "x", followUp: [] });
		expect(session.queue).toEqual({ steering: [], followUp: ["d"] });
	});
});

describe("DashboardSession starting prompt", () => {
	const image = { data: "aGk=", mimeType: "image/png" };

	test("a prompt omp admits while idle is working and starting from its ack, until its turn shows the user message", async () => {
		const { session, client, updates, rosters } = await startSession();
		const before = rosters();
		await session.prompt(null, "say pong", [image], "steer");
		expect(session.status).toBe("working");
		expect(session.starting).toEqual({ id: "req_1", text: "say pong", images: [image] });
		expect(updates.filter(update => update.kind === "starting")).toHaveLength(1);
		expect(rosters()).toBe(before + 1);

		client.fire({ type: "agent_start" });
		expect(session.starting).not.toBeNull();
		client.fire({ type: "message_start", message: { role: "user", timestamp: 1, content: "say pong" } });
		expect(session.starting).toBeNull();
		expect(session.status).toBe("working");
		expect(updates.filter(update => update.kind === "starting")).toHaveLength(2);

		client.fire({ type: "agent_end", messages: [] });
		expect(session.status).toBe("idle");
	});

	test("a prompt that ends without a turn goes back to idle on its prompt_result, even one that comes before its ack", async () => {
		const { session, client } = await startSession();
		await session.prompt(null, "denied", [], "steer");
		expect(session.status).toBe("working");
		client.settlePrompt("req_1");
		expect(session.status).toBe("idle");
		expect(session.starting).toBeNull();

		client.prompt = async () => {
			client.settlePrompt("req_2");
			return "req_2";
		};
		await session.prompt(null, "denied again", [], "steer");
		expect(session.status).toBe("idle");
		expect(session.starting).toBeNull();
	});

	test("a prompt omp refuses shows a note and rejects with PromptRefused", async () => {
		const { session, client, updates } = await startSession();
		client.prompt = async () => {
			throw new Error("busy");
		};
		await expect(session.prompt(null, "hi", [], "followUp")).rejects.toBeInstanceOf(PromptRefused);
		expect(updates).toContainEqual({ kind: "note", agentId: null, level: "error", text: "Prompt failed: busy" });
	});

	test("a builtin slash command omp completes itself never starts, a /skill: prompt does", async () => {
		const { session } = await startSession();
		await session.prompt(null, "/model", [], "steer");
		expect(session.starting).toBeNull();
		expect(session.status).toBe("idle");

		await session.prompt(null, "/skill:review the diff", [], "steer");
		expect(session.starting?.text).toBe("/skill:review the diff");
	});

	test("a prompt queued into a running turn, or one whose turn started before its ack, is not held as starting", async () => {
		const { session, client } = await startSession();
		client.fire({ type: "agent_start" });
		await session.prompt(null, "steer this", [], "steer");
		expect(session.starting).toBeNull();
		client.fire({ type: "agent_end", messages: [] });

		client.prompt = async () => {
			client.fire({ type: "agent_start" });
			return "req_9";
		};
		await session.prompt(null, "quick", [], "steer");
		expect(session.starting).toBeNull();
		expect(session.status).toBe("working");
	});

	test("a stop lets go of the starting prompt and hands it back first, even after its aborted prompt_result, unless its turn showed it", async () => {
		const { session, client } = await startSession();
		await session.prompt(null, "never mind", [image], "steer");
		client.abortAndRestoreQueue = async () => {
			client.settlePrompt("req_1");
			return { steering: [{ text: "and this" }], followUp: [] };
		};
		expect(await session.interrupt()).toEqual([{ text: "never mind", images: [image] }, { text: "and this", images: [] }]);
		expect(session.starting).toBeNull();
		expect(session.status).toBe("idle");

		await session.prompt(null, "shown", [], "steer");
		client.abortAndRestoreQueue = async () => {
			client.fire({ type: "message_start", message: { role: "user", timestamp: 2, content: "shown" } });
			return { steering: [], followUp: [] };
		};
		expect(await session.interrupt()).toEqual([]);
	});
});

describe("DashboardSession prompts", () => {
	test("a !! command is refused before anything reaches omp", async () => {
		const { session, client } = await startSession();
		await expect(session.prompt(null, "!!ls", [], "steer")).rejects.toBeInstanceOf(Error);
		expect(client.calls).toEqual([]);
	});

	test("an interrupt waits until a steer omp has not admitted yet is admitted, then takes it back", async () => {
		const { session, client } = await startSession();
		const admitted = Promise.withResolvers<string>();
		const order: string[] = [];
		client.prompt = async text => {
			order.push(`prompt ${text}`);
			return admitted.promise;
		};
		client.abortAndRestoreQueue = async () => {
			order.push("abort");
			return { steering: [{ text: "now" }], followUp: [] };
		};

		const sent = session.prompt(null, "now", [], "steer");
		const interrupted = session.interrupt();
		await settle();
		expect(order).toEqual(["prompt now"]);

		admitted.resolve("");
		await sent;
		expect(await interrupted).toEqual([{ text: "now", images: [] }]);
		expect(order).toEqual(["prompt now", "abort"]);
	});

	test("an interrupt does not wait for a message to a subagent, which omp does not queue on the turn", async () => {
		const { session, client } = await startSession();
		let aborted = false;
		client.steerSubagent = () => Promise.withResolvers<void>().promise;
		client.abortAndRestoreQueue = async () => {
			aborted = true;
			return { steering: [], followUp: [] };
		};

		void session.prompt("s1", "look at b", [], "steer");
		void session.interrupt();
		await settle();
		expect(aborted).toBe(true);
	});

	test("messages taken back from omp's queue keep their images, steers first", async () => {
		const { session, client } = await startSession();
		const png = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };
		client.removeQueuedMessage = async text => ({ removed: text === "look", images: [png] });
		client.abortAndRestoreQueue = async () => ({ steering: [{ text: "stop" }], followUp: [{ text: "then", images: [png] }] });

		expect(await session.dequeue(null, "followUp", "look")).toEqual({ text: "look", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] });
		expect(await session.dequeue(null, "followUp", "gone")).toBeNull();
		expect(await session.interrupt()).toEqual([
			{ text: "stop", images: [] },
			{ text: "then", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] },
		]);
	});

	test("an empty Enter stops the turn only while omp still holds a steer, read after the steer it follows is admitted", async () => {
		const { session, client } = await startSession();
		const order: string[] = [];
		let steering: string[] = [];
		const admitted = Promise.withResolvers<string>();
		client.prompt = async text => {
			order.push(`prompt ${text}`);
			await admitted.promise;
			steering = [text];
			return "";
		};
		client.getState = async () => ({ ...STATE, queuedMessages: { steering, followUp: [] } });
		client.abort = async () => {
			order.push("abort");
		};

		void session.prompt(null, "now", [], "steer");
		session.flush();
		await settle();
		expect(order).toEqual(["prompt now"]);
		admitted.resolve("");
		await settle();
		expect(order).toEqual(["prompt now", "abort"]);

		// The turn took the steer: omp's queue is empty again, so Enter leaves the turn that answers it alone.
		steering = [];
		session.flush();
		await settle();
		expect(order).toEqual(["prompt now", "abort"]);
	});

	test("an edit mid-turn stops the turn, branches, moves to omp's new file, then resends", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		const order: string[] = [];
		const session = await DashboardSession.start("inst-1", "/tmp/project", null, null, PLAIN_LAUNCH, update => {
			if (update.kind === "switched") order.push(`switched ${session.sessionId}`);
		});
		client.abort = async () => {
			order.push("abort");
		};
		client.branch = async entryId => {
			order.push(`branch ${entryId}`);
			return { text: "old", cancelled: false };
		};
		client.getState = async () => ({ ...STATE, sessionId: "session-2", sessionFile: "/tmp/session-2.jsonl" });
		client.prompt = async text => {
			order.push(`prompt ${text}`);
			return "";
		};

		client.fire({ type: "agent_start" });
		await session.editPrompt("e1", "new");
		expect(order).toEqual(["abort", "branch e1", "switched session-2", "prompt new"]);
		expect(session.sessionFile).toBe("/tmp/session-2.jsonl");
	});

	test("an edit an omp extension cancels keeps the session and sends nothing", async () => {
		const { session, client } = await startSession();
		client.branch = async () => ({ text: "old", cancelled: true });
		await expect(session.editPrompt("e1", "new")).rejects.toThrow("an omp extension cancelled the branch");
		expect(session.sessionId).toBe("session-1");
		expect(client.calls).toEqual([]);
	});
});

describe("DashboardSession action failures", () => {
	test("socket acknowledgments report failed interruption and termination through the real session paths", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.start("inst-1", "/tmp/project", null, null, PLAIN_LAUNCH, update => updates.push(update));
		client.abortAndRestoreQueue = async () => { throw new Error("abort unavailable"); };
		client.stop = async () => { throw new Error("stop unavailable"); };
		const sessions = new LiveSessions(() => {});
		sessions.add(session, null);
		const sent: ServerMsg[] = [];
		const ws = { data: { views: new Map(), pageId: "p" }, send: (raw: string) => void sent.push(JSON.parse(raw)) } as unknown as Socket;
		let removed = false;
		const failures: string[] = [];
		const ledger = new RequestLedger(createClientHandler({
			sessions,
			end: async (instanceId: string) => {
				const target = sessions.get(instanceId);
				if (target) await endSession({ sessionId: target.sessionId, workDir: target.cwd, end: () => target.end() }, async () => {
					removed = true;
					return null;
				});
			},
		} as SocketEnv), (_t, error) => failures.push(errorText(error)));
		ledger.open(ws);
		await ledger.handle(ws, { t: "resume", frames: [] });
		await ledger.handle(ws, { t: "interrupt", reqId: 1, ack: 1, floor: 1, view: { kind: "live", instanceId: "inst-1", agentId: null } });
		await ledger.handle(ws, { t: "end", instanceId: "inst-1", ack: 2, floor: 1 });
		expect(failures).toEqual(["abort unavailable", "stop unavailable"]);
		expect(sent).toEqual([
			{ t: "done", ack: 1, error: "abort unavailable" },
			{ t: "done", ack: 2, error: "stop unavailable" },
		]);
		expect(updates.filter(update => update.kind === "note").map(update => update.text)).toEqual(["Stop failed: abort unavailable"]);
		expect(removed).toBe(false);
	});

	test("thinking and fast failures reject for the caller and still emit their transcript notes", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.start("inst-1", "/tmp/project", null, null, PLAIN_LAUNCH, update => updates.push(update));
		client.setThinkingLevel = async () => { throw new Error("thinking unavailable"); };
		client.setFastMode = async () => { throw new Error("fast unavailable"); };
		await expect(session.setThinking("low")).rejects.toThrow("thinking unavailable");
		await expect(session.setFast(true)).rejects.toThrow("fast unavailable");
		expect(updates.filter(update => update.kind === "note").map(update => update.text)).toEqual([
			"Thinking level switch failed: thinking unavailable",
			"Fast mode switch failed: fast unavailable",
		]);
	});

	test("cancellation waits for omp and propagates its error with the transcript note", async () => {
		const client = new FakeClient();
		let lifecycle: (payload: unknown) => void = () => {};
		client.onSubagentLifecycle = listener => {
			lifecycle = listener;
			return () => {};
		};
		fakeOmp(client);
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.start("inst-1", "/tmp/project", null, null, PLAIN_LAUNCH, update => updates.push(update));
		lifecycle({ id: "a1", status: "started" });
		const response = Promise.withResolvers<boolean>();
		client.cancelSubagent = () => response.promise;
		let settled = false;
		const cancelling = session.cancelAgent("a1");
		void cancelling.then(() => { settled = true; }, () => { settled = true; });
		await settle();
		expect(settled).toBe(false);
		response.reject(new Error("cancel unavailable"));
		await expect(cancelling).rejects.toThrow("cancel unavailable");
		expect(updates.filter(update => update.kind === "note").map(update => update.text)).toEqual(["Cancel failed: cancel unavailable"]);
	});

	test("a message a subagent refuses shows a note on that agent and rejects with PromptRefused", async () => {
		const { session, client, updates } = await startSession();
		client.steerSubagent = async () => { throw new Error("not running"); };
		await expect(session.prompt("a1", "hi", [], "steer")).rejects.toBeInstanceOf(PromptRefused);
		expect(updates).toContainEqual({ kind: "note", agentId: "a1", level: "error", text: "Message failed: not running" });
	});

	test("a failed edit rejects with omp's error and shows it as a note", async () => {
		const { session, client, updates } = await startSession();
		client.branch = async () => ({ text: "old", cancelled: true });
		await expect(session.editPrompt("e1", "new")).rejects.toThrow("an omp extension cancelled the branch");
		expect(updates.filter(update => update.kind === "note").map(update => update.text)).toEqual(["Edit failed: an omp extension cancelled the branch"]);
	});
});

describe("DashboardSession fast mode", () => {
	const on = (provider: string, api: string, org: string, serviceTiers?: string[]): RpcState => ({
		...STATE,
		model: { provider, id: "m", name: "M", contextWindow: 200_000, api, identity: { class: org }, serviceTiers },
		fastModeEnabled: true,
		fastModeActive: true,
	});

	test("the session offers /fast only while its model has a priority tier, with omp's state after each switch", async () => {
		const { session, client } = await startSession();
		const after = async (state: RpcState) => {
			client.getState = async () => state;
			await session.setFast(true);
			await settle();
			return session.fast;
		};
		expect(await after(on("anthropic", "anthropic-messages", "anthropic"))).toEqual({ enabled: true, active: true });
		expect(await after(on("cursor", "cursor-agent", "anthropic"))).toBeNull();
		expect(await after(on("openai-codex", "openai-codex-responses", "openai", ["flex"]))).toBeNull();
		expect(await after(on("openai-codex", "openai-codex-responses", "openai", ["priority"]))).toEqual({ enabled: true, active: true });
		expect(client.calls.filter(call => call.startsWith("fast"))).toEqual(["fast true", "fast true", "fast true", "fast true"]);
	});
});

describe("DashboardSession start", () => {
	test("a start that fails after omp spawned stops the process, then drops the questions it was asked", async () => {
		const client = new FakeClient();
		const omp = fakeOmp(client);
		const order: string[] = [];
		client.stop = async () => {
			order.push("stop");
		};
		client.setModel = async () => {
			omp.onFrame({ type: "extension_ui_request", id: "r1", method: "confirm", title: "Deploy?", message: "" });
			throw new Error("no such model");
		};

		await expect(
			DashboardSession.start("inst-1", "/tmp/project", { provider: "p", id: "m" }, null, PLAIN_LAUNCH, update => order.push(update.kind)),
		).rejects.toThrow("no such model");

		// The question arrived (a roster change), the process stopped, and only then was the question dropped (another).
		expect(order).toEqual(["roster", "stop", "roster"]);
	});
});

describe("DashboardSession reattach", () => {
	/** A session a previous server started, whose omp a test plays through `client` and ends through `exit`. */
	function keptOmp(client: FakeClient) {
		const exit = Promise.withResolvers<"detach" | "exit">();
		const hungUp: string[] = [];
		const child: RpcChild = { client, pid: 4343, exited: exit.promise, write: () => {}, meta: { startedAt: 1_700_000_000_000, cwd: "/tmp/kept" }, detach: () => { hungUp.push("detach"); exit.resolve("detach"); } };
		spyOn(rpc, "attachRpc").mockImplementation(async (_instanceId, onFrame) => {
			// The keeper hands the new server the question omp still waits on.
			onFrame({ type: "extension_ui_request", id: "q1", method: "confirm", title: "Deploy?", message: "" });
			return child;
		});
		return { exit, hungUp };
	}

	test("a session attached mid-turn works on with its question, subagents, start time, and its project's tools", async () => {
		const client = new FakeClient();
		keptOmp(client);
		client.getState = async () => ({ ...STATE, sessionId: "kept-1", isStreaming: true });
		client.getSubagents = async () => [{ id: "a1", agent: "explore", status: "running", description: "Read the docs" }];
		const tool = { name: "project_status", label: "Status", description: "", parameters: {}, loadMode: "essential" as const, execute: async () => "" };
		const asked: string[] = [];
		const session = await DashboardSession.reattach("inst-kept", sessionId => (asked.push(sessionId), [tool]), () => {});

		expect(asked).toEqual(["kept-1"]);
		expect(client.calls).toContain("tools project_status");
		const row = session.row();
		expect([row.instanceId, row.pid, row.startedAt, row.cwd, row.status]).toEqual(["inst-kept", 4343, 1_700_000_000_000, "/tmp/kept", "needs-input"]);
		expect(row.requests.map(request => request.title)).toEqual(["Deploy?"]);
		expect(row.agents).toMatchObject([{ id: "a1", kind: "explore", status: "running", activity: "Read the docs" }]);

		session.answer("q1", { kind: "confirm", confirmed: true });
		expect(session.status).toBe("working");
		client.fire({ type: "agent_end", messages: [] });
		await settle();
		expect(session.status).toBe("idle");
	});

	test("the server shutting down hangs up on omp without ending it, reporting an exit, or counting it finished", async () => {
		const client = new FakeClient();
		const { hungUp } = keptOmp(client);
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.reattach("inst-kept", () => [], update => updates.push(update));
		const stops: string[] = [];
		client.stop = async () => {
			stops.push("stop");
		};
		await session.dispose();
		await settle();
		expect([hungUp, stops, updates.filter(update => update.kind === "exited"), session.finished()]).toEqual([["detach"], [], [], false]);
	});

	test("End session on an attached session stops omp and reports the exit as ended", async () => {
		const client = new FakeClient();
		const { exit } = keptOmp(client);
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.reattach("inst-kept", () => [], update => updates.push(update));
		client.stop = async () => exit.resolve("exit");
		await session.end();
		await settle();
		expect(updates.filter(update => update.kind === "exited")).toEqual([{ kind: "exited", ended: true }]);
	});

	test("a session attached while it waits on a background job works until the job's result ends its turn", async () => {
		const client = new FakeClient();
		keptOmp(client);
		client.getState = async () => ({ ...STATE, hasPendingAsyncWork: true });
		const session = await DashboardSession.reattach("inst-kept", () => [], () => {});
		session.answer("q1", { kind: "confirm", confirmed: true });
		expect(session.status).toBe("working");
		client.fire({ type: "agent_start" });
		client.fire({ type: "agent_end", messages: [], isTerminal: false });
		await settle();
		expect(session.status).toBe("working");
		client.fire({ type: "agent_end", messages: [] });
		await settle();
		expect(session.status).toBe("idle");
	});

	test("a session attached mid-turn whose turn ends on a usage limit reports the limit before it reads idle", async () => {
		const client = new FakeClient();
		keptOmp(client);
		client.getState = async () => ({ ...STATE, isStreaming: true });
		const updates: DashboardUpdate[] = [];
		const session = await DashboardSession.reattach("inst-kept", () => [], update => updates.push(update));
		session.answer("q1", { kind: "confirm", confirmed: true });
		const from = updates.length;
		const limited = {
			role: "assistant",
			content: [],
			stopReason: "error",
			provider: "opencode-go",
			errorStatus: 429,
			errorMessage: "429 Go usage limit exceeded retry-after-ms=200813000\nGo usage limit exceeded (type=GoUsageLimitError)",
		};
		client.fire({ type: "agent_end", messages: [limited] });
		const ended = updates.slice(from).filter(update => update.kind === "turn-ended" || update.kind === "roster");
		expect([ended.slice(0, 2), session.status]).toEqual([[{ kind: "turn-ended", reply: null, failure: { kind: "usage-limit", provider: "opencode-go", retryAfterMs: 200_813_000 } }, { kind: "roster" }], "idle"]);
	});

	test("a session file with no directory in its header and a broken replay marker attaches where omp started, as a replay", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-reattach-"));
		try {
			const file = join(dir, "session.jsonl");
			const at = new Date(0).toISOString();
			writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "kept-1", timestamp: at })}\n${JSON.stringify({ type: "custom", id: "e1", parentId: null, timestamp: at, customType: "omp-agents-replay", data: {} })}\n`);
			const client = new FakeClient();
			keptOmp(client);
			client.getState = async () => ({ ...STATE, sessionFile: file });
			const session = await DashboardSession.reattach("inst-kept", () => [], () => {});
			expect(session.row().cwd).toBe("/tmp/kept");
			await expect(session.prompt("a1", "hi", [], "steer")).rejects.toThrow("Subagent prompts are blocked in a replay.");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an attach that fails hangs up and leaves omp running for the next server", async () => {
		const client = new FakeClient();
		const { hungUp } = keptOmp(client);
		const stops: string[] = [];
		client.stop = async () => {
			stops.push("stop");
		};
		client.getSubagents = async () => {
			throw new Error("omp did not answer");
		};
		await expect(DashboardSession.reattach("inst-kept", () => [], () => {})).rejects.toThrow("omp did not answer");
		expect([hungUp, stops]).toEqual([["detach"], []]);
	});
});

describe("DashboardSession replay admission", () => {
	function preparedReplay(): PreparedReplay {
		return {
			forkFile: "/tmp/replay.jsonl", cwd: "/tmp/replay", config: "/tmp/replay.jsonl.replay.yml",
			first: { text: "first", images: [] }, discard: async () => {},
			marker: {
				v: 1, id: "replay-id", source: { sessionId: "original", file: "/tmp/original.jsonl", turnId: "prompt-id", at: 1 },
				roots: { original: ["/tmp/original"], replay: "/tmp/replay" }, base: { sha: "a".repeat(40), how: "head-now" },
				model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinking: "low",
				repaired: false, promptEdited: false, modelChanged: false, original: null, originalTurnRef: `blob:sha256:${"b".repeat(64)}`,
			},
		};
	}

	test("opens the native fork before applying settings and admits exactly one initial prompt", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		const order: string[] = [];
		spyOn(client, "switchSession").mockImplementation(async () => { order.push("switch"); return { cancelled: false }; });
		const model = spyOn(client, "setModel").mockImplementation(async (provider, id) => { order.push("model"); return { provider, id }; });
		const thinking = spyOn(client, "setThinkingLevel").mockImplementation(async () => { order.push("thinking"); });
		const ready = spyOn(replayLaunch, "requireReplayReady").mockImplementation(async () => { order.push("guard"); });
		const prepared = preparedReplay();
		const session = await DashboardSession.replay("replay-instance", prepared, PLAIN_LAUNCH, () => {});
		expect(order).toEqual(["switch", "model", "thinking", "guard"]);
		expect(model).toHaveBeenCalledWith("openai-codex", "gpt-5.6-sol");
		expect(thinking).toHaveBeenCalledWith("low");
		expect(ready).toHaveBeenCalledWith(prepared.forkFile, prepared.marker.id, expect.any(String));
		await expect(session.setModel(prepared.marker.model, "low")).rejects.toThrow("first replay turn");
		await expect(session.setThinking("low")).rejects.toThrow("first replay turn");
		await expect(session.editPrompt("prompt-id", "changed")).rejects.toThrow("first replay turn");
		await expect(session.prompt(null, "interleaved before send", [], "followUp")).rejects.toThrow("selected first replay prompt");
		await expect(session.prompt("old-task", "steer", [], "followUp")).rejects.toThrow("Subagent");
		await session.prompt(null, prepared.first.text, [], "followUp");
		await expect(session.prompt(null, "interleaved", [], "followUp")).rejects.toThrow("first replay turn");
		expect(client.calls).toEqual(["prompt first"]);
		client.settlePrompt("req_1");
		await settle();
		await expect(session.prompt(null, "/new", [], "followUp")).rejects.toThrow("slash");
		await expect(session.editPrompt("prompt-id", "  /new")).rejects.toThrow("slash");
		await session.prompt(null, "second", [], "followUp");
		expect(client.calls).toEqual(["prompt first", "prompt second"]);
	});

	test("a refused first send releases admission without resending it automatically", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		spyOn(replayLaunch, "requireReplayReady").mockResolvedValue(undefined);
		const send = spyOn(client, "prompt").mockRejectedValueOnce(new Error("quota exhausted"));
		const session = await DashboardSession.replay("replay-instance", preparedReplay(), PLAIN_LAUNCH, () => {});
		await expect(session.prompt(null, "first", [], "followUp")).rejects.toThrow("quota exhausted");
		await settle();
		expect(send).toHaveBeenCalledTimes(1);
		await session.prompt(null, "manual retry", [], "followUp");
		expect(send).toHaveBeenCalledTimes(2);
	});

	test("cancelled opening stops the native child before failing replay startup", async () => {
		const client = new FakeClient();
		fakeOmp(client);
		spyOn(client, "switchSession").mockResolvedValue({ cancelled: true });
		const stopped = spyOn(client, "stop");
		await expect(DashboardSession.replay("replay-instance", preparedReplay(), PLAIN_LAUNCH, () => {})).rejects.toThrow("cancelled");
		expect(stopped).toHaveBeenCalledTimes(1);
	});
});
