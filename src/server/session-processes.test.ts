import { describe, expect, test } from "bun:test";
import type { DaemonReport } from "../omp/modules";
import { parsePs } from "../process-census";
import { SessionProcessWatch, type WatchedSession } from "./session-processes";

const T0 = Date.parse("Fri Oct 3 09:00:00 2026");
const minutes = (count: number): number => T0 + count * 60_000;

const OMP_A = "  100     1   100  51200   2.0 Fri Oct  3 09:00:00 2026     omp";
const MCP_A = "  101   100   100  20480   0.5 Fri Oct  3 09:00:00 2026     node mcp.js";
const DEV = "  110   100   110   4096   1.0 Fri Oct  3 09:00:00 2026     bun run dev";
const VITE = "  111   110   110  10240  30.0 Fri Oct  3 09:00:00 2026     node vite.js";
const OMP_B = "  200     1   200  51200   4.0 Fri Oct  3 09:00:00 2026     omp";
const BROWSER = "  300     1   300   2048   6.5 Fri Oct  3 09:00:00 2026     chromium --headless";
const PS = [OMP_A, MCP_A, DEV, VITE, OMP_B, BROWSER];

const DEV_ID = JSON.stringify(["job", 110, "Fri Oct 3 09:00:00 2026"]);
const BROWSER_ID = JSON.stringify(["service", "/run/repo", "browser", "g1"]);
const API_ID = JSON.stringify(["service", "/run/repo", "api", "g2"]);

const SCOPE = { kind: "project", runtimeDir: "/run/repo", projectDir: "/repo" } as const;
const BROWSER_DAEMON = { snapshot: { name: "browser", id: "g1", state: "running", pid: 300, startedAt: T0 }, supervised: true } as const;
const API_DAEMON = { snapshot: { name: "api", id: "g2", state: "running", startedAt: T0, owner: "sa" }, command: "bun api.ts", supervised: true } as const;

const A: WatchedSession = { instanceId: "a", sessionId: "sa", pid: 100, cwd: "/repo", status: "idle" };
const B: WatchedSession = { instanceId: "b", sessionId: "sb", pid: 200, cwd: "/repo/wt", status: "working" };

/** A watch over a computer whose processes, daemons, sessions, and clock the test sets; a stop takes what it stopped off the computer. */
function computer(daemons: DaemonReport["daemons"] = [BROWSER_DAEMON, API_DAEMON]) {
	const state = {
		now: T0,
		ps: PS,
		reports: [{ scope: SCOPE, daemons: [...daemons] }] as DaemonReport[],
		sessions: [A, B],
		owner: true,
		minutes: 30 as number | null,
		/** What `lsof` finds listening, by pid; `null` when it fails. Pid 400 is your own server of the same app, pid 500 an API in Docker. */
		listeners: new Map([
			[111, [5173, 24678]],
			[110, [5173]],
			[300, [9222]],
			[100, [4000]],
			[400, [3000]],
			[500, [8000]],
		]) as Map<number, number[]> | null,
		cwds: new Map([
			[100, "/repo"],
			[110, "/repo/wt/front"],
			[111, "/repo/wt/front"],
			[300, "/"],
			[400, "/repo/front"],
			[500, "/"],
		]),
	};
	const stopped: string[] = [];
	const watch = new SessionProcessWatch({
		readTable: async () => parsePs(state.ps.join("\n")),
		readPorts: async () => state.listeners,
		readCwds: async pids => new Map([...state.cwds].filter(([pid]) => pids.includes(pid))),
		appOf: async dir => (dir === "/repo" ? "/repo/.git\n" : dir.startsWith("/repo/") ? `/repo/.git\n${dir.split("/").at(-1)}/` : null),
		readDaemons: async () => state.reports,
		projectDir: async cwd => (cwd.startsWith("/repo") ? "/repo" : cwd),
		stopService: async (_scope, name, id) => {
			stopped.push(`service ${name} ${id}`);
			for (const report of state.reports) report.daemons = report.daemons.filter(daemon => daemon.snapshot.id !== id);
		},
		stopProcesses: async processes => {
			stopped.push(`job ${[...processes.keys()].join(",")}`);
			state.ps = state.ps.filter(line => !processes.has(Number(line.trim().split(/\s+/)[0])));
		},
		sessions: () => state.sessions,
		now: () => state.now,
		owner: () => state.owner,
		stopIdleAfterMinutes: () => state.minutes,
	});
	/** Samples at `count` minutes past the start. */
	const tickAt = (count: number): Promise<void> => {
		state.now = minutes(count);
		return watch.tick();
	};
	/** Session `instanceId`'s processes, as the whole list has them. */
	const processesOf = async (instanceId: string) => (await watch.list()).find(each => each.instanceId === instanceId)?.processes;
	return { state, stopped, watch, tickAt, processesOf };
}

describe("SessionProcessWatch", () => {
	test("lists every live session's jobs and services in roster order, biggest memory first, with omp and its MCP servers apart, and the ports other apps listen on", async () => {
		const { watch } = computer();
		expect(await watch.list()).toEqual([
			{
				instanceId: "a",
				omp: { memoryBytes: 73_400_320, cpuPercent: 2.5, processCount: 2 },
				processes: [
					{ id: DEV_ID, kind: "job", shared: false, label: "bun run dev", memoryBytes: 14_680_064, cpuPercent: 31, processCount: 2, ports: [5173, 24678], startedAt: T0, stopsAt: minutes(30) },
					{ id: BROWSER_ID, kind: "service", shared: true, label: "browser", memoryBytes: 2_097_152, cpuPercent: 6.5, processCount: 1, ports: [9222], startedAt: T0, stopsAt: null },
					{ id: API_ID, kind: "service", shared: false, label: "api: bun api.ts", memoryBytes: 0, cpuPercent: 0, processCount: 0, ports: [], startedAt: T0, stopsAt: minutes(30) },
				],
				otherPorts: [4000, 8000, 9222],
			},
			{
				instanceId: "b",
				omp: { memoryBytes: 52_428_800, cpuPercent: 4, processCount: 1 },
				processes: [{ id: BROWSER_ID, kind: "service", shared: true, label: "browser", memoryBytes: 2_097_152, cpuPercent: 6.5, processCount: 1, ports: [9222], startedAt: T0, stopsAt: null }],
				otherPorts: [3000, 4000, 5173, 8000, 9222, 24678],
			},
		]);
	});

	test("a failed lsof lists every process with no ports", async () => {
		const { state, processesOf, watch } = computer();
		state.listeners = null;
		expect((await processesOf("a"))?.map(item => item.ports)).toEqual([[], [], []]);
		expect((await watch.list()).map(each => each.otherPorts)).toEqual([[], []]);
	});

	test("a busy session's processes never stop", async () => {
		const { state, stopped, tickAt, processesOf } = computer();
		state.sessions = [{ ...A, status: "needs-input" }, B];
		await tickAt(0);
		await tickAt(600);
		expect(stopped).toEqual([]);
		expect((await processesOf("a"))?.map(item => item.stopsAt)).toEqual([null, null, null]);
	});

	test("an idle session's job stops exactly the setting's minutes after the session was last seen busy", async () => {
		const { state, stopped, watch, tickAt } = computer([]);
		state.sessions = [{ ...A, status: "working" }, B];
		await tickAt(0);
		await tickAt(10);
		state.sessions = [A, B];
		await tickAt(10.25);
		state.now = minutes(40) - 1;
		await watch.tick();
		expect(stopped).toEqual([]);
		await tickAt(40);
		expect(stopped).toEqual(["job 110,111"]);
	});

	test("a shared service stops only once every session of its project has been idle the setting's minutes", async () => {
		const { state, stopped, tickAt } = computer([BROWSER_DAEMON]);
		await tickAt(0);
		await tickAt(20);
		state.sessions = [A, { ...B, status: "idle" }];
		await tickAt(20.25);
		await tickAt(30);
		expect(stopped).toEqual(["job 110,111"]);
		await tickAt(50);
		expect(stopped).toEqual(["job 110,111", "service browser g1"]);
	});

	test("a server without the owner lock lists no stop and stops nothing", async () => {
		const { state, stopped, tickAt, processesOf } = computer();
		state.owner = false;
		state.sessions = [A, { ...B, status: "idle" }];
		await tickAt(0);
		await tickAt(600);
		expect(stopped).toEqual([]);
		expect((await processesOf("a"))?.map(item => item.stopsAt)).toEqual([null, null, null]);
	});

	test("with the idle stop off nothing stops", async () => {
		const { state, stopped, tickAt, processesOf } = computer();
		state.minutes = null;
		state.sessions = [A, { ...B, status: "idle" }];
		await tickAt(0);
		await tickAt(600);
		expect(stopped).toEqual([]);
		expect((await processesOf("b"))?.map(item => item.stopsAt)).toEqual([null]);
	});

	test("a session that left the roster has its services and reparented jobs stopped once its omp exits, and not before", async () => {
		const { state, stopped, tickAt } = computer();
		state.sessions = [{ ...A, status: "working" }, B];
		await tickAt(0);
		state.sessions = [B];
		await tickAt(1);
		expect(stopped).toEqual([]);
		state.ps = [DEV.replace("  110   100", "  110     1"), VITE, OMP_B, BROWSER];
		await tickAt(2);
		expect(stopped).toEqual(["service api g2", "job 110,111"]);
		await tickAt(3);
		expect(stopped).toEqual(["service api g2", "job 110,111"]);
	});

	test("a stop of a process or session that no longer runs answers the list without stopping anything, and a stop of one that runs ends it", async () => {
		const { state, stopped, watch } = computer();
		state.sessions = [{ ...A, status: "working" }, B];
		const listed = await watch.list();
		expect(await watch.stop("a", JSON.stringify(["job", 110, "Fri Oct 3 08:00:00 2026"]))).toEqual(listed);
		expect(await watch.stop("gone", DEV_ID)).toEqual(listed);
		expect(stopped).toEqual([]);
		expect((await watch.stop("a", DEV_ID)).map(each => [each.instanceId, each.processes.map(item => item.id)])).toEqual([
			["a", [BROWSER_ID, API_ID]],
			["b", [BROWSER_ID]],
		]);
		expect(stopped).toEqual(["job 110,111"]);
	});
});
