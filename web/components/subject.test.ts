import { describe, expect, test } from "bun:test";
import type { AgentRow, ControlPhase, LiveView, RosterHost } from "../../src/shared/sessions";
import { subjectOf } from "./subject";

const LIVE: ControlPhase = { phase: "live", readOnly: false };

const host = (source: "dashboard" | "terminal", overrides: Partial<RosterHost> = {}) =>
	({
		instanceId: "i1",
		source,
		status: "idle",
		control: LIVE,
		agents: [],
		requests: [],
		queue: { steering: [], followUp: [] },
		thinkingLevels: ["off", "high"],
		...overrides,
	}) as RosterHost;

const agent = (overrides: Partial<AgentRow> = {}): AgentRow => ({
	id: "a1",
	kind: "task",
	parentId: null,
	status: "running",
	activity: null,
	canMessage: true,
	queue: { steering: ["x"], followUp: [] },
	...overrides,
});

const session: LiveView = { kind: "live", instanceId: "i1", agentId: null };
const subagent: LiveView = { kind: "live", instanceId: "i1", agentId: "a1" };

describe("subjectOf a session", () => {
	test("a session this dashboard started takes text and images, runs ! over RPC, and switches its model", () => {
		const row = host("dashboard", { status: "working" });
		const subject = subjectOf(session, row, null);
		expect(subject).toMatchObject({ kind: "session", writable: true, images: true, working: true, shell: "rpc", followUps: true });
		expect(subject.kind === "session" && subject.switchable?.thinkingLevels).toEqual(["off", "high"]);
	});

	test("a terminal room takes no ! command and no model switch", () => {
		const subject = subjectOf(session, host("terminal"), null);
		expect(subject).toMatchObject({ writable: true, shell: "none" });
		expect(subject.kind === "session" && subject.switchable).toBeNull();
	});

	test("a read-only room is not writable and leaves its questions unanswerable", () => {
		const row = host("terminal", { control: { phase: "live", readOnly: true }, requests: [{ id: "q" }] as RosterHost["requests"] });
		expect(subjectOf(session, row, null)).toMatchObject({ live: false, writable: false, images: false, requests: [] });
	});

	test("a session that left the roster is ended, and the header keeps its last row", () => {
		const last = host("dashboard");
		const subject = subjectOf(session, null, last);
		expect(subject.phase).toEqual({ phase: "ended", reason: "This session is no longer running." });
		expect(subject).toMatchObject({ host: null, shown: last, writable: false, working: false, queue: undefined });
	});
});

describe("subjectOf a subagent", () => {
	test("is messaged and attached files as text only, and works while it runs", () => {
		const row = host("dashboard", { status: "working", agents: [agent()] });
		const subject = subjectOf(subagent, row, null);
		expect(subject).toMatchObject({ kind: "subagent", writable: true, images: false, working: true, shell: "none" });
		expect(subject.queue).toEqual({ steering: ["x"], followUp: [] });
	});

	test("an agent omp cannot message leaves the composer disabled", () => {
		const row = host("terminal", { agents: [agent({ canMessage: false, status: "parked" })] });
		expect(subjectOf(subagent, row, null)).toMatchObject({ writable: false, working: false });
	});

	test("one that is no longer registered is ended", () => {
		const subject = subjectOf(subagent, host("terminal"), null);
		expect(subject.phase).toEqual({ phase: "ended", reason: "This subagent is no longer registered." });
		expect(subject).toMatchObject({ agent: null, writable: false });
	});

	test("holds no follow-up for a subagent of a session this dashboard started, since RPC reaches only a running one", () => {
		const agents = [agent()];
		expect(subjectOf(subagent, host("dashboard", { agents }), null).followUps).toBe(false);
		expect(subjectOf(subagent, host("terminal", { agents }), null).followUps).toBe(true);
	});
});
