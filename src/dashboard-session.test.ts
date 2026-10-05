import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { DashboardSession, type DashboardUpdate } from "./dashboard-session";
import type { Frame } from "./omp/collab";
import * as rpc from "./omp/rpc";
import type { RpcChild, RpcClient, RpcState } from "./omp/rpc";

const STATE: RpcState = { sessionId: "session-1", queuedMessages: { steering: [], followUp: [] } };

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
	removeQueuedMessage = async () => ({ removed: true });
	abort = async (): Promise<void> => {};
	getAvailableModels = async () => [];
	setModel: RpcClient["setModel"] = async (provider, id) => ({ provider, id });
	getAvailableThinkingLevels = async () => ["off", "low"];
	setThinkingLevel = async (): Promise<void> => {};
	setSubagentSubscription = async () => "progress";
	getSubagents = async () => [];
	switchSession = async () => ({ cancelled: false });
	branch = async () => ({ text: "", cancelled: false });
	newSession = async () => ({ cancelled: false });
	onSessionEvent = (listener: (event: Frame) => void) => {
		this.#listeners.push(listener);
		return () => {};
	};
	onSubagentLifecycle = () => () => {};
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
	const session = await DashboardSession.start("inst-1", "/tmp/project", model, null, update => updates.push(update));
	return { session, client, rosters: () => updates.filter(update => update.kind === "roster").length };
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
		client.fire({ type: "model_changed" });
		client.fire({ type: "turn_end" });
		await settle();
		expect(reads).toHaveLength(1);

		reads[0]?.resolve({ ...STATE, sessionName: "first" });
		await settle();
		expect(reads).toHaveLength(2);
		expect(session.sessionName).toBe("first");

		reads[1]?.resolve({ ...STATE, sessionName: "second" });
		await settle();
		expect(reads).toHaveLength(2);
		expect(session.sessionName).toBe("second");
	});
});

describe("DashboardSession turns", () => {
	test("an agent_end that is not terminal hands over to a queued follow-up, so the session keeps working", async () => {
		const { session, client } = await startSession();
		client.fire({ type: "agent_start" });
		expect(session.status).toBe("working");

		client.fire({ type: "agent_end", isTerminal: false });
		expect(session.status).toBe("working");

		client.fire({ type: "agent_end", isTerminal: true });
		expect(session.status).toBe("idle");
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
			DashboardSession.start("inst-1", "/tmp/project", { provider: "p", id: "m" }, null, update => order.push(update.kind)),
		).rejects.toThrow("no such model");

		// The question arrived (a roster change), the process stopped, and only then was the question dropped (another).
		expect(order).toEqual(["roster", "stop", "roster"]);
	});
});
