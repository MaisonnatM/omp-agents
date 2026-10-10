import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardSession, type DashboardUpdate } from "./dashboard-session";
import type { Frame } from "./omp/collab";
import * as rpc from "./omp/rpc";
import { PLAIN_LAUNCH, type RpcChild, type RpcClient, type RpcState } from "./omp/rpc";
import { LiveSessions } from "./server/live-sessions";
import { endSession } from "./server/session-end";
import { createClientHandler, type SocketEnv } from "./server/socket";
import type { Socket } from "./server/views";
import type { ServerMsg } from "./shared/protocol";

const STATE: RpcState = { sessionId: "session-1", fastModeEnabled: false, fastModeActive: false, queuedMessages: { steering: [], followUp: [] } };

/** An omp RPC client whose methods answer at once, records what the session sends omp, and lets a test play omp's events. */
class FakeClient implements RpcClient {
	calls: string[] = [];
	#listeners: ((event: Frame) => void)[] = [];

	start = async (): Promise<void> => {};
	stop: RpcClient["stop"] = async () => {};
	getState: RpcClient["getState"] = async () => STATE;
	prompt: RpcClient["prompt"] = async text => {
		this.calls.push(`prompt ${text}`);
		return "";
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
	getSubagents = async () => [];
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
	bash: RpcClient["bash"] = async command => {
		this.calls.push(`bash ${command}`);
	};

	/** A session event as omp's RPC client hands it to the session. */
	fire(event: Record<string, unknown>): void {
		for (const listener of this.#listeners) listener({ t: "event", ...event });
	}
}

/** Lets every promise reaction that is already queued, and the ones it queues in turn, run. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** An omp process that never exits, driven through `client`; `startRpc` hands `onFrame` to the session. */
function fakeOmp(client: FakeClient) {
	const child: RpcChild = { client, pid: 4242, exited: Promise.withResolvers<void>().promise, write: () => {} };
	const omp = { onFrame: (_frame: Record<string, unknown>) => {} };
	spyOn(rpc, "startRpc").mockImplementation(async (_cwd, onFrame) => {
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
		expect(ended()).toEqual([{ kind: "turn-ended", reply: "Done: ok" }]);
		client.fire({ type: "agent_end", messages: [] });
		expect(ended().at(-1)).toEqual({ kind: "turn-ended", reply: null });
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
		const ws = { data: { views: new Map() }, send: (raw: string) => void sent.push(JSON.parse(raw)) } as unknown as Socket;
		let removed = false;
		const handle = createClientHandler({
			sessions,
			end: async (instanceId: string) => {
				const target = sessions.get(instanceId);
				if (target) await endSession({ sessionId: target.sessionId, workDir: target.cwd, end: () => target.end() }, async () => {
					removed = true;
					return null;
				});
			},
		} as SocketEnv);
		await expect(handle(ws, { t: "interrupt", reqId: 1, ack: 1, view: { kind: "live", instanceId: "inst-1", agentId: null } })).rejects.toThrow("abort unavailable");
		await expect(handle(ws, { t: "end", instanceId: "inst-1", ack: 2 })).rejects.toThrow("stop unavailable");
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
