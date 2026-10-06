import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as commands from "./commands";
import { SessionGuest } from "./guest";
import type { LiveUpdate } from "./live-session";
import * as collab from "./omp/collab";
import type { CollabSocket, Frame, HostSnapshot, Room } from "./omp/collab";
import { registry } from "./omp/modules";

/** A Collab socket that records what the guest sends and lets a test play the host's frames. */
class FakeSocket implements CollabSocket {
	onOpen?: () => void;
	onFrame?: (frame: Frame, fromPeer: number) => void;
	onClose?: (reason: string, willReconnect: boolean) => void;
	sent: Record<string, unknown>[] = [];
	closed = false;
	/** Settles once the guest connects the socket. */
	readonly connected = Promise.withResolvers<void>();
	connect(): void {
		this.connected.resolve();
	}
	send(frame: object): void {
		this.sent.push({ ...frame });
	}
	close(): void {
		this.closed = true;
	}
	/** Everything the guest sent after `hello`. */
	get messages(): Record<string, unknown>[] {
		return this.sent.filter(frame => frame.t !== "hello");
	}
	frame(frame: Frame): void {
		this.onFrame?.(frame, 0);
	}
}

const host = (overrides: Partial<HostSnapshot> = {}): HostSnapshot => ({
	instanceId: "inst-1",
	generation: 1,
	pid: 4242,
	sessionId: "session-1",
	sessionName: null,
	cwd: "/tmp/project",
	model: { provider: "anthropic", id: "claude" },
	startedAt: 1,
	participants: 1,
	relayConnected: true,
	inputRequired: false,
	busy: false,
	access: "control",
	...overrides,
});

const agent = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, displayName: "explore", kind: "task", status, createdAt: 1, ...extra });
const MAIN = { id: "main", displayName: "main", kind: "main", status: "running", createdAt: 1 };
const state = (isStreaming: boolean): Frame => ({ t: "state", state: { isStreaming, model: { provider: "anthropic", id: "claude" } } });

const ENDED = { phase: "ended" } as const;

/** A guest for `snapshot`, and a promise that settles once it ends. */
function start(snapshot: HostSnapshot = host()) {
	const ended = Promise.withResolvers<void>();
	const guest: SessionGuest = new SessionGuest(snapshot, () => {
		if (guest.control.phase === "ended") ended.resolve();
	});
	guests.push(guest);
	return { guest, ended: ended.promise };
}

/** Lets every promise reaction that is already queued, and the ones it queues in turn, run. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

const guests: SessionGuest[] = [];
const dirs: string[] = [];
afterEach(async () => {
	mock.restore();
	await Promise.all(guests.splice(0).map(guest => guest.dispose()));
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface JoinOptions {
	/** Whether the room hands out a write token (a control link) or not (a view link). */
	writable?: boolean;
	welcome?: Record<string, unknown>;
	host?: Partial<HostSnapshot>;
}

/** Join a guest to a fake room and play the host's welcome. */
async function joinRoom(options: JoinOptions = {}) {
	const socket = new FakeSocket();
	const room: Room = { socket, generation: 1, access: "control", writeToken: options.writable === false ? undefined : "token" };
	spyOn(collab, "openRoom").mockResolvedValue(room);
	const updates: LiveUpdate[] = [];
	const guest: SessionGuest = new SessionGuest(host(options.host), update => updates.push(update));
	guests.push(guest);
	await socket.connected.promise;
	socket.onOpen?.();
	socket.frame({ t: "welcome", agents: [MAIN], state: { isStreaming: false }, ...options.welcome });
	const notes = () => updates.filter((update): update is Extract<LiveUpdate, { kind: "note" }> => update.kind === "note");
	return { guest, socket, updates, notes };
}

describe("SessionGuest follow-ups", () => {
	test("a follow-up sent during a turn is held, and goes out once the host's state stops streaming", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });

		guest.send(null, { text: "then run tests", payload: "then run tests" }, "followUp");
		expect(socket.messages).toEqual([]);
		expect(guest.queue(null)).toEqual({ steering: [], followUp: ["then run tests"] });

		socket.frame(state(true));
		expect(socket.messages).toEqual([]);

		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "then run tests" }]);
		expect(guest.queue(null).followUp).toEqual([]);
	});

	test("a held follow-up goes out with its images once the turn ends", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		const image = { data: "aGVsbG8=", mimeType: "image/png" };
		guest.send(null, { text: "like this", payload: "like this", images: [image] }, "followUp");
		expect(socket.messages).toEqual([]);

		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "like this", images: [{ type: "image", ...image }] }]);
	});

	test("a steer reaches a running turn at once, and a follow-up with no turn running is not held", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "stop that", payload: "stop that" }, "steer");
		expect(socket.messages).toEqual([{ t: "prompt", text: "stop that" }]);

		socket.frame(state(false));
		guest.send(null, { text: "next", payload: "next" }, "followUp");
		expect(socket.messages.at(-1)).toEqual({ t: "prompt", text: "next" });
		expect(guest.queue(null).followUp).toEqual([]);
	});

	test("held follow-ups go out one per finished turn, in order", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "one", payload: "one" }, "followUp");
		guest.send(null, { text: "two", payload: "two" }, "followUp");

		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "one" }]);
		expect(guest.queue(null).followUp).toEqual(["two"]);

		// Frames that repeat an idle host do not start the next one early.
		socket.frame({ t: "state", state: { isStreaming: false, thinkingLevel: "high" } });
		expect(socket.messages).toHaveLength(1);

		socket.frame(state(true));
		socket.frame(state(false));
		expect(socket.messages).toEqual([
			{ t: "prompt", text: "one" },
			{ t: "prompt", text: "two" },
		]);
	});

	test("an abort waits until a steer that is still being prepared is sent", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		const prepared = Promise.withResolvers<string>();
		spyOn(commands, "expandPrompt").mockImplementation(() => prepared.promise);
		const sending = guest.prompt(null, "now", [], "steer");
		guest.abort();
		await settle();
		expect(socket.messages).toEqual([]);

		prepared.resolve("now");
		await sending;
		await settle();
		expect(socket.messages).toEqual([
			{ t: "prompt", text: "now" },
			{ t: "abort" },
		]);
	});

	test("an empty Enter stops the turn while a steer waits, whether the host reported it or this guest just sent it", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.flush();
		await settle();
		expect(socket.messages).toEqual([]);

		guest.send(null, { text: "now", payload: "now" }, "steer");
		guest.flush();
		await settle();
		expect(socket.messages).toEqual([{ t: "prompt", text: "now" }, { t: "abort" }]);
	});

	test("once the host's state shows the steer taken, an empty Enter leaves the turn that answers it alone", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "now", payload: "now" }, "steer");
		socket.frame({ t: "state", state: { isStreaming: true, queuedMessageCount: 1 } });
		socket.frame({ t: "state", state: { isStreaming: true, queuedMessageCount: 0 } });
		guest.flush();
		await settle();
		expect(socket.messages).toEqual([{ t: "prompt", text: "now" }]);
	});

	test("a follow-up held after the guest's own abort waits for the next turn to end", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "after", payload: "after" }, "followUp");

		guest.abort();
		await settle();
		expect(socket.messages).toEqual([{ t: "abort" }]);
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "abort" }]);
		expect(guest.queue(null).followUp).toEqual(["after"]);

		// The user starts a new turn; when it ends the held message goes.
		socket.frame({ t: "event", event: { type: "agent_start" } });
		socket.frame(state(true));
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "abort" }, { t: "prompt", text: "after" }]);
	});

	test("a reply cut off mid-stream holds follow-ups back the same way", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "after", payload: "after" }, "followUp");

		socket.frame({ t: "event", event: { type: "message_end", message: { role: "assistant", stopReason: "aborted" } } });
		socket.frame(state(false));
		expect(socket.messages).toEqual([]);
		expect(guest.queue(null).followUp).toEqual(["after"]);

		socket.frame({ t: "event", event: { type: "agent_start" } });
		socket.frame(state(true));
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "after" }]);
	});

	test("a reply that ends normally does not hold follow-ups back", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "after", payload: "after" }, "followUp");
		socket.frame({ t: "event", event: { type: "message_end", message: { role: "assistant", stopReason: "stop" } } });
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "after" }]);
	});

	test("a held follow-up can be taken back until its turn ends", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "first", payload: "first" }, "followUp");
		guest.send(null, { text: "second", payload: "second" }, "followUp");

		expect(await guest.dequeue(null, "followUp", "first")).toBe(true);
		expect(await guest.dequeue(null, "steering", "second")).toBe(false);
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "second" }]);
		expect(await guest.dequeue(null, "followUp", "second")).toBe(false);
	});

	test("the queue shows what the user typed while the host receives the expanded skill or file command", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "omp-agents-guest-"));
		dirs.push(cwd);
		mkdirSync(join(cwd, ".omp", "commands"), { recursive: true });
		writeFileSync(join(cwd, ".omp", "commands", "review.md"), "---\ndescription: Review\n---\nReview carefully: $ARGUMENTS\n");
		const { guest, socket } = await joinRoom({ host: { cwd, instanceId: "inst-expand" }, welcome: { state: { isStreaming: true } } });

		await guest.prompt(null, "/review src/a.ts", [], "followUp");
		expect(guest.queue(null).followUp).toEqual(["/review src/a.ts"]);
		socket.frame(state(false));
		expect(socket.messages).toEqual([{ t: "prompt", text: "Review carefully: src/a.ts" }]);
	});

	test("a prompt for a command the host cannot run is rejected and nothing is sent", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "omp-agents-guest-"));
		dirs.push(cwd);
		const { guest, socket } = await joinRoom({ host: { cwd, instanceId: "inst-unknown" } });
		await expect(guest.prompt(null, "/definitely-not-a-command now", [], "steer")).rejects.toThrow("/definitely-not-a-command");
		expect(socket.messages).toEqual([]);
	});
});

describe("SessionGuest subagents", () => {
	test("a follow-up for a running subagent goes out when an agents frame shows it no longer running", async () => {
		const { guest, socket } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running")] } });

		guest.send("s1", { text: "also check b", payload: "also check b" }, "followUp");
		expect(socket.messages).toEqual([]);
		expect(guest.queue("s1").followUp).toEqual(["also check b"]);

		socket.frame({ t: "agents", agents: [MAIN, agent("s1", "running")] });
		expect(socket.messages).toEqual([]);

		socket.frame({ t: "agents", agents: [MAIN, agent("s1", "idle")] });
		expect(socket.messages).toEqual([{ t: "agent-cmd", cmd: "chat", agentId: "s1", text: "also check b" }]);
		expect(guest.queue("s1").followUp).toEqual([]);
	});

	test("a subagent's turn ending is not affected by the main agent's own interrupt", async () => {
		const { guest, socket } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running")] } });
		guest.send("s1", { text: "later", payload: "later" }, "followUp");
		guest.abort();
		await settle();
		socket.frame({ t: "agents", agents: [MAIN, agent("s1", "idle")] });
		expect(socket.messages).toEqual([{ t: "abort" }, { t: "agent-cmd", cmd: "chat", agentId: "s1", text: "later" }]);
	});

	test("a steer to a subagent goes out at once, and a parked subagent is revived by the same chat", async () => {
		const { guest, socket } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running"), agent("s2", "parked")] } });
		guest.send("s1", { text: "steer", payload: "steer" }, "steer");
		guest.send("s2", { text: "wake", payload: "wake" }, "followUp");
		expect(socket.messages).toEqual([
			{ t: "agent-cmd", cmd: "chat", agentId: "s1", text: "steer" },
			{ t: "agent-cmd", cmd: "chat", agentId: "s2", text: "wake" },
		]);
	});

	test("a held follow-up for a subagent that was aborted or left is dropped with a warning on its pane", async () => {
		const { guest, socket, notes } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running"), agent("s2", "running")] } });
		guest.send("s1", { text: "a", payload: "a" }, "followUp");
		guest.send("s1", { text: "b", payload: "b" }, "followUp");
		guest.send("s2", { text: "c", payload: "c" }, "followUp");

		socket.frame({ t: "agents", agents: [MAIN, agent("s1", "aborted")] });

		expect(socket.messages).toEqual([]);
		expect(guest.queue("s1").followUp).toEqual([]);
		expect(guest.queue("s2").followUp).toEqual([]);
		const warnings = notes();
		expect(warnings).toMatchObject([
			{ kind: "note", agentId: "s1", level: "warning" },
			{ kind: "note", agentId: "s2", level: "warning" },
		]);
		expect(warnings[0]?.text).toEndWith("a\nb");
		expect(warnings[1]?.text).toEndWith("c");
	});

	test("messages for an aborted or unknown subagent are not sent", async () => {
		const { guest, socket } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "aborted")] } });
		guest.send("s1", { text: "x", payload: "x" }, "steer");
		guest.send("ghost", { text: "y", payload: "y" }, "steer");
		expect(socket.messages).toEqual([]);
	});

	test("cancel kills only a running subagent, and a read-only room kills nothing", async () => {
		const { guest, socket } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running"), agent("s2", "idle"), agent("s3", "parked")] } });
		for (const id of ["s1", "s2", "s3", "ghost"]) guest.cancelAgent(id);
		expect(socket.messages).toEqual([{ t: "agent-cmd", cmd: "kill", agentId: "s1" }]);

		const readOnly = await joinRoom({ welcome: { readOnly: true, agents: [MAIN, agent("s1", "running")] } });
		readOnly.guest.cancelAgent("s1");
		expect(readOnly.socket.messages).toEqual([]);
	});

	test("rows list subagents only, flatten children of unlisted parents, and mark an aborted one as not messageable", async () => {
		const { guest, socket } = await joinRoom({
			welcome: { agents: [MAIN, agent("p", "running"), agent("c", "idle", { parentId: "p" }), agent("o", "aborted", { parentId: "gone" })] },
		});
		expect(guest.agents().map(({ id, parentId, status, canMessage }) => ({ id, parentId, status, canMessage }))).toEqual([
			{ id: "p", parentId: null, status: "running", canMessage: true },
			{ id: "c", parentId: "p", status: "idle", canMessage: true },
			{ id: "o", parentId: null, status: "aborted", canMessage: false },
		]);

		socket.frame({
			t: "bus",
			channel: "task:subagent:progress",
			data: { assignment: "ignored", progress: { id: "p", currentToolIntent: "Reading   files" } },
		});
		expect(guest.agents()[0]?.activity).toBe("Reading files");

		// What the guest learned about a subagent leaves with it.
		socket.frame({ t: "agents", agents: [MAIN] });
		socket.frame({ t: "agents", agents: [MAIN, agent("p", "running")] });
		expect(guest.agents()[0]?.activity).toBeNull();
	});
});

describe("SessionGuest read-only rooms", () => {
	test("a welcome that marks the room read-only makes every row unmessageable and sends nothing", async () => {
		const { guest, socket } = await joinRoom({ welcome: { readOnly: true, agents: [MAIN, agent("s1", "running")] } });
		expect(guest.canWrite).toBe(false);
		expect(guest.control).toEqual({ phase: "live", readOnly: true });
		expect(guest.agents().map(row => row.canMessage)).toEqual([false]);

		guest.send(null, { text: "hi", payload: "hi" }, "steer");
		guest.send("s1", { text: "hi", payload: "hi" }, "steer");
		guest.abort();
		guest.answer("1", { kind: "cancel" });
		expect(socket.messages).toEqual([]);
	});

	test("a view link with no write token is read-only even when the welcome does not say so", async () => {
		const { guest, socket } = await joinRoom({ writable: false, welcome: { agents: [MAIN, agent("s1", "idle")] } });
		expect(guest.control).toEqual({ phase: "live", readOnly: true });
		expect(guest.agents().map(row => row.canMessage)).toEqual([false]);
		guest.send(null, { text: "hi", payload: "hi" }, "steer");
		expect(socket.messages).toEqual([]);
	});

	test("a control link says hello with its write token and takes prompts once welcomed", async () => {
		const { guest, socket } = await joinRoom();
		expect(socket.sent[0]).toMatchObject({ t: "hello", name: "omp-agents", writeToken: "token" });
		expect(guest.control).toEqual({ phase: "live", readOnly: false });
		guest.send(null, { text: "hi", payload: "hi" }, "steer");
		expect(socket.messages).toEqual([{ t: "prompt", text: "hi" }]);
	});

	test("nothing is sent before the host welcomes the guest", async () => {
		const socket = new FakeSocket();
		spyOn(collab, "openRoom").mockResolvedValue({ socket, generation: 1, access: "control", writeToken: "token" });
		const { guest } = start();
		await socket.connected.promise;
		guest.send(null, { text: "early", payload: "early" }, "steer");
		guest.abort();
		expect(socket.sent).toEqual([]);
		expect(guest.control).toEqual({ phase: "connecting" });
	});
});

describe("SessionGuest linking", () => {
	const stale = () => new registry.CollabLinkError("stale_generation" as never, "the host switched rooms" as never);

	test("a stale_generation link failure is retried until the host's new room answers", async () => {
		const socket = new FakeSocket();
		const open = spyOn(collab, "openRoom")
			.mockRejectedValueOnce(stale())
			.mockRejectedValueOnce(stale())
			.mockResolvedValue({ socket, generation: 7, access: "control", writeToken: "token" });
		const { guest } = start();
		await socket.connected.promise;
		expect(open).toHaveBeenCalledTimes(3);
		expect(guest.generation).toBe(7);
		socket.frame({ t: "welcome" });
		expect(guest.control).toEqual({ phase: "live", readOnly: false });
	});

	test("a host that keeps switching ends the guest after a few attempts, and any other link failure is not retried", async () => {
		const staleOpen = spyOn(collab, "openRoom").mockRejectedValue(stale());
		const switching = start();
		await switching.ended;
		expect(staleOpen).toHaveBeenCalledTimes(3);
		expect(switching.guest.control).toMatchObject(ENDED);

		staleOpen.mockReset();
		staleOpen.mockRejectedValue(new registry.CollabLinkError("not_found" as never, "no such host" as never));
		const missing = start(host({ instanceId: "inst-2" }));
		await missing.ended;
		expect(staleOpen).toHaveBeenCalledTimes(1);
		expect(missing.guest.control).toEqual({ phase: "ended", reason: expect.stringContaining("no such host") });
	});

	test("a dropped relay shows as reconnecting, and a close with no retry ends the guest", async () => {
		const { guest, socket } = await joinRoom();
		socket.onClose?.("relay dropped", true);
		expect(guest.control).toEqual({ phase: "reconnecting", reason: "relay dropped" });
		socket.onClose?.("relay gave up", false);
		expect(guest.control).toEqual({ phase: "ended", reason: "relay gave up" });
		expect(socket.closed).toBe(true);
	});
});

describe("SessionGuest lifetime", () => {
	test("follow-ups still held when the host ends the room are reported on their pane, not lost silently", async () => {
		const { guest, socket, notes } = await joinRoom({ welcome: { state: { isStreaming: true }, agents: [MAIN, agent("s1", "running")] } });
		guest.send(null, { text: "main one", payload: "main one" }, "followUp");
		guest.send("s1", { text: "sub one", payload: "sub one" }, "followUp");

		socket.frame({ t: "bye", reason: "host quit" });

		expect(guest.control).toEqual({ phase: "ended", reason: "Host ended the room: host quit" });
		const warnings = notes();
		expect(warnings).toMatchObject([
			{ kind: "note", agentId: null, level: "warning" },
			{ kind: "note", agentId: "s1", level: "warning" },
		]);
		expect(warnings[0]?.text).toEndWith("main one");
		expect(warnings[1]?.text).toEndWith("sub one");
		expect(guest.queue(null).followUp).toEqual([]);
		expect(socket.messages).toEqual([]);
	});

	test("a host that is gone from the registry, or moved to a new room generation, ends the guest", async () => {
		const gone = await joinRoom();
		expect(gone.guest.follow(new Map())).toBe(false);
		expect(gone.guest.control).toMatchObject(ENDED);

		const moved = await joinRoom({ host: { instanceId: "inst-3" } });
		const next = host({ instanceId: "inst-3", generation: 2 });
		expect(moved.guest.follow(new Map([[next.instanceId, next]]))).toBe(false);
		expect(moved.guest.control).toMatchObject(ENDED);

		const same = await joinRoom({ host: { instanceId: "inst-4" } });
		const listed = host({ instanceId: "inst-4", participants: 3 });
		expect(same.guest.follow(new Map([[listed.instanceId, listed]]))).toBe(true);
		expect(same.guest.row()).toMatchObject({ participants: 3 });
	});

	test("a host error names the subagent it concerns, or reports as the host's", async () => {
		const { socket, notes } = await joinRoom({ welcome: { agents: [MAIN, agent("s1", "running")] } });
		socket.frame({ t: "error", message: "agent s1: not running" });
		socket.frame({ t: "error", message: "rate limited" });
		expect(notes()).toEqual([
			{ kind: "note", agentId: "s1", level: "error", text: "agent s1: not running" },
			{ kind: "note", agentId: null, level: "error", text: "Host: rate limited" },
		]);
	});

	test("frames after the guest ended change nothing", async () => {
		const { guest, socket } = await joinRoom({ welcome: { state: { isStreaming: true } } });
		guest.send(null, { text: "held", payload: "held" }, "followUp");
		guest.disconnect("done");
		socket.frame(state(false));
		expect(socket.messages).toEqual([]);
	});
});
