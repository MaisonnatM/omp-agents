import { describe, expect, test } from "bun:test";
import type { MemoryReading, Pressure } from "../shared/resources";
import { decide, type PolicyInput, type PolicyItem, type PolicySession, type PolicyStray, PRIVATE_NOTICE_MS, type Stop, STRAY_GRACE_MS, STRAY_SETTLE_MS } from "./memory-policy";

const NOW = Date.parse("Fri Nov 27 12:00:00 2026");
const MIN = 60_000;
const MB = 1024 * 1024;

const reading = (pressure: Pressure): MemoryReading => ({ pressure, totalBytes: 16_384 * MB, availableBytes: 1024 * MB, swapUsedBytes: 0, swapOutBytesPerMin: 0, swapOutBytes: 0, calmTicks: 0, at: NOW });

/** A dashboard session idle and settled for `idleMin` minutes. */
const session = (instanceId: string, idleMin: number, extra: Partial<PolicySession> = {}): PolicySession => ({
	instanceId,
	title: `Session ${instanceId}`,
	sessionId: `s${instanceId}`,
	file: null,
	pid: 100,
	cwd: "/repo",
	status: "idle",
	waitsOnWork: false,
	stopsWhenIdle: true,
	private: false,
	idleSince: NOW - idleMin * MIN,
	settledSince: NOW - idleMin * MIN,
	memoryBytes: 300 * MB,
	...extra,
});

const item = (id: string, instanceIds: string[], mb: number): PolicyItem => ({ id, label: id, instanceIds, memoryBytes: mb * MB, startedAt: NOW - 60 * MIN, shared: false });

const stray = (instanceId: string, seenMin: number, reason: PolicyStray["reason"], mb = 500): PolicyStray => ({
	port: reason === "unattached" ? 4317 : 4400,
	instanceId,
	keeperPid: 900,
	private: false,
	startedAt: NOW - seenMin * MIN,
	reason,
	firstSeen: NOW - seenMin * MIN,
	memoryBytes: mb * MB,
	title: null,
});

const input = (pressure: Pressure | null, parts: Partial<PolicyInput>): PolicyInput => ({
	now: NOW,
	reading: pressure === null ? null : reading(pressure),
	settings: { stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: null },
	sessions: [],
	items: [],
	strays: [],
	...parts,
});

/** What each stop ends, as `kind name because`. */
const named = (stops: Stop[]): string[] =>
	stops.map(stop => `${stop.kind} ${stop.kind === "item" ? stop.id : stop.kind === "session" ? stop.instanceId : stop.keeper.instanceId} ${stop.because}`);

describe("decide", () => {
	test("under normal pressure only the idle stops run, on the settings' timers, and unattended work may start", () => {
		const decision = decide(
			input("normal", {
				settings: { stopIdleAfterMinutes: 30, stopIdleSessionsAfterHours: 24 },
				sessions: [session("a", 31), session("b", 24 * 60), session("c", 0, { status: "working" })],
				items: [item("dev", ["a"], 100), item("api", ["c"], 100), item("shared", ["a", "c"], 100)],
			}),
		);
		expect(named(decision.stops)).toEqual(["item dev idle", "session b idle"]);
		expect(decision.stopsAt.get("dev")).toBe(NOW - MIN);
		expect(decision.stopsAt.get("api")).toBeNull();
		expect(decision.stopsAt.get("shared")).toBeNull();
		expect(decision.holdsUnattended).toBeNull();
		// The warn ladder still shows what pressure would stop next, leaving out what already stops.
		expect(decision.ladder.map(entry => entry.owner)).toEqual([{ kind: "session", instanceId: "a", title: "Session a", private: false }]);
	});

	test("warn stops the first owner of the ladder: a settled stray first, then idle processes, then settled sessions; never a private one", () => {
		const parts: Partial<PolicyInput> = {
			sessions: [session("a", 30), session("b", 25), session("p", 120, { private: true })],
			items: [item("small", ["a"], 50), item("big", ["b"], 400)],
			strays: [stray("k1", 2, "orphan-port", 200), stray("k2", 3, "unattached", 600), stray("fresh", 0, "unattached", 900), stray("other", 9, "foreign-live", 900)],
		};
		const decision = decide(input("warn", parts));
		expect(decision.ladder.map(entry => [entry.rung, entry.owner.kind === "stray" ? entry.owner.keeperId : entry.owner.kind === "session" ? entry.owner.instanceId : entry.owner.kind === "process" ? entry.owner.id : ""])).toEqual([
			[0, "k2"],
			[0, "k1"],
			[2, "big"],
			[2, "small"],
			[3, "a"],
			[3, "b"],
		]);
		expect(named(decision.stops)).toEqual(["stray k2 warn"]);
		expect(decision.holdsUnattended).toBe("Memory is under pressure, so unattended work waits until it eases.");
	});

	test("critical stops the first three owners, sessions settled 2 minutes, and a private one settled an hour", () => {
		const decision = decide(input("critical", { sessions: [session("p", 61, { private: true }), session("a", 3), session("q", 59, { private: true })] }));
		expect(decision.ladder.map(entry => entry.rung)).toEqual([3, 4]);
		expect(named(decision.stops)).toEqual(["session a critical", "session p critical"]);
		expect(decision.holdsUnattended).toBe("Memory pressure is critical, so unattended work waits until it eases.");
	});

	test("a busy session, one asking a question, one waiting on its work, and their processes never stop under pressure", () => {
		const decision = decide(
			input("critical", {
				sessions: [session("w", 60, { status: "working" }), session("q", 60, { status: "needs-input" }), session("s", 60, { waitsOnWork: true }), session("t", 60, { stopsWhenIdle: false })],
				items: [item("w-dev", ["w"], 100), item("q-dev", ["q"], 100), item("s-dev", ["s"], 100)],
			}),
		);
		expect(decision.ladder).toEqual([]);
		expect(decision.stops).toEqual([]);
	});

	test("a stray ends after the grace whatever the pressure, another live server's never, and unknown pressure stops nothing else and holds unattended work", () => {
		const decision = decide(
			input(null, {
				sessions: [session("a", 60)],
				strays: [stray("old", STRAY_GRACE_MS / MIN, "orphan-port"), stray("young", STRAY_SETTLE_MS / MIN, "unattached"), stray("other", 60, "foreign-live")],
			}),
		);
		expect(decision.pressure).toBe("unknown");
		expect(named(decision.stops)).toEqual(["stray old stray"]);
		expect(decision.ladder.map(entry => entry.rung)).toEqual([0, 3]);
		expect(decision.holdsUnattended).toBe("Memory pressure could not be read, so unattended work waits until it can.");
	});

	test("a private session ends at the idle session stop's hours like any other, named in the warnings the last five minutes before", () => {
		const hours = { stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 2 };
		const at = (idleMin: number) => decide(input("normal", { settings: hours, sessions: [session("p", idleMin, { private: true }), session("a", idleMin)] }));
		expect(at(120 - PRIVATE_NOTICE_MS / MIN - 1).warnings).toEqual([]);
		expect(at(120 - PRIVATE_NOTICE_MS / MIN).warnings).toEqual([{ sessionId: "sp", title: "Session p", deletesAt: NOW + PRIVATE_NOTICE_MS }]);
		expect(named(at(120).stops)).toEqual(["session p idle", "session a idle"]);
		expect(at(120).warnings).toEqual([]);
	});
});
