import { describe, expect, test } from "bun:test";
import type { UnitSnapshot } from "../omp/module-types/processes";
import { parsePs } from "../process-census";
import type { KeptProcess } from "../keeper-link";
import type { PrivateDeleting } from "../shared/notices";
import type { Pressure } from "../shared/resources";
import { LIST_REUSE_MS, SessionProcessWatch, STRAY_STOP_ID, type WatchedSession } from "./session-processes";

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
const BROWSER_ID = JSON.stringify(["service", "u1", "g1"]);
const API_ID = JSON.stringify(["service", "u2", "g2"]);

const SCOPE = { kind: "project", dir: "/repo" } as const;
const BROWSER_UNIT: UnitSnapshot = { id: "u1", kind: "proc", scope: SCOPE, key: "browser", generation: "g1", state: "running", pids: [300], startedAt: T0, supervised: true };
const API_UNIT: UnitSnapshot = { id: "u2", kind: "proc", scope: SCOPE, key: "api", generation: "g2", state: "running", pids: [], startedAt: T0, owner: "sa", command: "bun api.ts", supervised: true };

const A: WatchedSession = { instanceId: "a", title: "A", sessionId: "sa", file: "/sessions/a.jsonl", pid: 100, cwd: "/repo", status: "idle", waitsOnWork: false, stopsWhenIdle: true, private: false };
const B: WatchedSession = { instanceId: "b", title: "B", sessionId: "sb", file: "/sessions/b.jsonl", pid: 200, cwd: "/repo/wt", status: "working", waitsOnWork: false, stopsWhenIdle: true, private: false };
/** This server's port, whose keepers' directory it owns. */
const PORT = 4317;

/** A watch over a computer whose processes, services, sessions, and clock the test sets; a stop takes what it stopped off the computer. */
function computer(services: UnitSnapshot[] = [BROWSER_UNIT, API_UNIT]) {
	const state = {
		now: T0,
		ps: PS,
		services: [...services],
		sessions: [A, B],
		owner: true,
		minutes: 30 as number | null,
		hours: 24 as number | null,
		/** When omp last wrote each session's file, by instance id. */
		written: new Map<string, number>(),
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
		pressure: "normal" as Pressure,
		/** Every port's running keepers. */
		keepers: [] as KeptProcess[],
		/** The private sessions the last sample named as about to be deleted. */
		warnings: [] as PrivateDeleting[],
	};
	const stopped: string[] = [];
	/** The session file in each process's environment, by pid. */
	const sessionFiles = new Map<number, string>();
	/** The session file each process holds open, by pid; `null` makes `lsof` fail. */
	const openFiles = { files: new Map<number, string>() as Map<number, string> | null, reads: [] as number[][] };
	/** Each session file's title, by path. */
	const titles = new Map<string, string>();
	const watch = new SessionProcessWatch({
		readTable: async () => parsePs(state.ps.join("\n")),
		readPorts: async () => state.listeners,
		readCwds: async pids => new Map([...state.cwds].filter(([pid]) => pids.includes(pid))),
		readSessionFiles: async pids => new Map([...sessionFiles].filter(([pid]) => pids.includes(pid))),
		readOpenSessionFiles: async pids => {
			openFiles.reads.push([...pids]);
			return openFiles.files && new Map([...openFiles.files].filter(([pid]) => pids.includes(pid)));
		},
		titleOf: async file => titles.get(file) ?? null,
		appOf: async dir => (dir === "/repo" ? "/repo/.git\n" : dir.startsWith("/repo/") ? `/repo/.git\n${dir.split("/").at(-1)}/` : null),
		readServices: async () => state.services,
		projectDir: async cwd => (cwd.startsWith("/repo") ? "/repo" : cwd),
		stopService: async unit => {
			stopped.push(`service ${unit.key} ${unit.generation}`);
			state.services = state.services.filter(each => each.id !== unit.id);
		},
		stopProcesses: async processes => {
			stopped.push(`job ${[...processes.keys()].join(",")}`);
			state.ps = state.ps.filter(line => !processes.has(Number(line.trim().split(/\s+/)[0])));
		},
		sessions: () => state.sessions,
		endSession: async instanceId => {
			stopped.push(`session ${instanceId}`);
			state.sessions = state.sessions.filter(session => session.instanceId !== instanceId);
		},
		lastWrittenAt: instanceId => state.written.get(instanceId) ?? null,
		now: () => state.now,
		owner: () => state.owner,
		settings: () => ({ stopIdleAfterMinutes: state.minutes, stopIdleSessionsAfterHours: state.hours }),
		readMemory: async () => ({ pressure: state.pressure, totalBytes: 0, availableBytes: 0, swapUsedBytes: 0, swapOutBytesPerMin: 0, swapOutBytes: 0, calmTicks: 0, at: state.now }),
		readKeepers: () => state.keepers,
		port: PORT,
		endStray: async keeper => {
			stopped.push(`stray ${keeper.instanceId}`);
			state.keepers = state.keepers.filter(each => each !== keeper && each.instanceId !== keeper.instanceId);
		},
		record: () => {},
		warn: warnings => {
			state.warnings = warnings;
		},
	});
	/** Samples at `count` minutes past the start. */
	const tickAt = (count: number): Promise<void> => {
		state.now = minutes(count);
		return watch.tick();
	};
	/** Session `instanceId`'s processes, as the whole list has them. */
	const processesOf = async (instanceId: string) => (await watch.list()).find(each => each.instanceId === instanceId)?.processes;
	return { state, stopped, sessionFiles, openFiles, titles, watch, tickAt, processesOf };
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
		const { state, stopped, tickAt } = computer([BROWSER_UNIT]);
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
		await tickAt(48 * 60);
		expect(stopped).toEqual([]);
		expect((await processesOf("a"))?.map(item => item.stopsAt)).toEqual([null, null, null]);
	});

	test("with both idle stops off nothing stops", async () => {
		const { state, stopped, tickAt, processesOf } = computer();
		state.minutes = null;
		state.hours = null;
		state.sessions = [A, { ...B, status: "idle" }];
		await tickAt(0);
		await tickAt(48 * 60);
		expect(stopped).toEqual([]);
		expect((await processesOf("b"))?.map(item => item.stopsAt)).toEqual([null]);
	});

	test("an idle session ends exactly the setting's hours after it was last seen busy or waiting on a subagent, and once", async () => {
		const { state, stopped, watch, tickAt } = computer([]);
		state.minutes = null;
		state.sessions = [{ ...A, status: "working" }, B];
		await tickAt(0);
		await tickAt(60);
		state.sessions = [{ ...A, waitsOnWork: true }, B];
		await tickAt(120);
		state.sessions = [A, B];
		await tickAt(121);
		state.now = minutes(120 + 24 * 60) - 1;
		await watch.tick();
		expect(stopped).toEqual([]);
		await tickAt(120 + 24 * 60);
		expect(stopped).toEqual(["session a"]);
		await tickAt(200 + 24 * 60);
		expect(stopped).toEqual(["session a"]);
	});

	test("a server a session's command left running in the background lists and stops as that session's job, and a keeper's tree does not", async () => {
		const { state, stopped, sessionFiles, tickAt, processesOf } = computer([]);
		const server = "  120     1   115  40960   3.0 Fri Oct  3 09:00:00 2026     node server.js";
		const worker = "  121   120   115  40960   1.0 Fri Oct  3 09:00:00 2026     node worker.js";
		const keeper = "  150     1   150   2048   0.0 Fri Oct  3 09:00:00 2026     bun keeper.ts";
		const keptOmp = "  200   150   200  51200   4.0 Fri Oct  3 09:00:00 2026     omp";
		state.ps = [OMP_A, MCP_A, DEV, VITE, keeper, keptOmp, BROWSER, server, worker];
		sessionFiles.set(120, "/sessions/a/Explorer.jsonl");
		sessionFiles.set(150, "/sessions/a.jsonl");
		await tickAt(0);
		expect((await processesOf("a"))?.map(item => [item.label, item.processCount, item.stopsAt])).toEqual([
			["node server.js", 2, minutes(30)],
			["bun run dev", 2, minutes(30)],
		]);
		expect(await processesOf("b")).toEqual([]);
		state.sessions = [B];
		state.ps = state.ps.filter(line => line !== OMP_A && line !== MCP_A);
		await tickAt(5);
		expect(stopped).toEqual(["job 110,111,120,121"]);
	});

	test("a session that works, asks a question, or waits on a subagent never ends", async () => {
		const { state, stopped, tickAt } = computer([]);
		state.minutes = null;
		state.sessions = [{ ...A, status: "needs-input" }, B, { ...B, instanceId: "c", sessionId: "sc", status: "idle", waitsOnWork: true }];
		await tickAt(0);
		await tickAt(48 * 60);
		expect(stopped).toEqual([]);
	});

	test("a session started in a terminal never ends, and a private one ends at the hours like any other, named in the warnings its last five minutes", async () => {
		const { state, stopped, tickAt } = computer([]);
		state.minutes = null;
		state.sessions = [{ ...A, private: true }, { ...B, status: "idle", stopsWhenIdle: false }];
		await tickAt(0);
		await tickAt(24 * 60 - 6);
		expect(state.warnings).toEqual([]);
		await tickAt(24 * 60 - 5);
		expect(state.warnings).toEqual([{ sessionId: "sa", title: "A", deletesAt: minutes(24 * 60) }]);
		expect(stopped).toEqual([]);
		await tickAt(24 * 60);
		await tickAt(48 * 60);
		expect(stopped).toEqual(["session a"]);
	});

	test("an omp no server lists ends after the grace, or on a Stop, while another live server's never does", async () => {
		const { state, stopped, tickAt, watch } = computer([]);
		state.minutes = null;
		state.sessions = [{ ...A, status: "working" }];
		const keeper = (instanceId: string, port: number): KeptProcess => ({ port, instanceId, keeperPid: 150, private: false, startedAt: T0 });
		// Port 3000 is listened on by pid 400; nothing listens on port 4500.
		state.keepers = [keeper("a", PORT), keeper("lost", PORT), keeper("old", 4500), keeper("theirs", 3000), keeper("asked", PORT)];
		await tickAt(0);
		expect(stopped).toEqual([]);
		await watch.stop("theirs", STRAY_STOP_ID);
		await watch.stop("asked", STRAY_STOP_ID);
		expect(stopped).toEqual(["stray asked"]);
		await tickAt(10);
		expect(stopped.toSorted()).toEqual(["stray asked", "stray lost", "stray old"]);
		await tickAt(60);
		expect(stopped).toHaveLength(3);
	});

	test("names each stray by the title of the session file its omp holds open, read once per stray with one lsof for all of them", async () => {
		const { state, openFiles, titles, tickAt, watch } = computer([]);
		state.minutes = null;
		state.sessions = [{ ...A, status: "working" }];
		const keeperRow = (pid: number) => `  ${pid}     1   ${pid}   1024   0.0 Fri Oct  3 09:00:00 2026     bun keeper.ts`;
		const ompRow = (pid: number, keeperPid: number) => `  ${pid}   ${keeperPid}   ${pid}  40960   0.0 Fri Oct  3 09:00:00 2026     omp`;
		state.ps = [...PS, keeperRow(160), ompRow(161, 160), keeperRow(170), ompRow(171, 170)];
		const keeper = (instanceId: string, keeperPid: number): KeptProcess => ({ port: PORT, instanceId, keeperPid, private: false, startedAt: T0 });
		state.keepers = [keeper("named", 160), keeper("untitled", 170)];
		titles.set("/sessions/-repo-/1_s1.jsonl", "Fix the login");
		const strayTitles = async () => new Map((await watch.view()).footprints.flatMap(({ owner }) => (owner.kind === "stray" ? [[owner.keeperId, owner.title] as const] : [])));
		// A failed lsof leaves both untitled and reads them again at the next sample.
		openFiles.files = null;
		await tickAt(0);
		expect(await strayTitles()).toEqual(new Map([["named", null], ["untitled", null]]));
		openFiles.files = new Map([[161, "/sessions/-repo-/1_s1.jsonl"]]);
		await tickAt(1);
		await tickAt(2);
		expect(await strayTitles()).toEqual(new Map([["named", "Fix the login"], ["untitled", null]]));
		expect(openFiles.reads).toEqual([[161, 171], [161, 171]]);
	});

	test("unattended work waits until memory is read at normal pressure, and while it is not; the user's work never waits", async () => {
		const { state, tickAt, watch } = computer([]);
		expect(watch.admit("unattended")).toEqual({ go: false, reason: "Memory has not been read yet, so unattended work waits until it is." });
		expect(watch.admit("interactive")).toEqual({ go: true });
		await tickAt(0);
		expect(watch.admit("unattended")).toEqual({ go: true });
		state.pressure = "warn";
		await tickAt(1);
		expect(watch.admit("unattended")).toEqual({ go: false, reason: "Memory is under pressure, so unattended work waits until it eases." });
		expect(watch.admit("interactive")).toEqual({ go: true });
	});

	test("warn pressure stops the biggest process of a session idle 5 minutes, one per sample, and records it", async () => {
		const { state, stopped, tickAt, watch } = computer([]);
		state.minutes = null;
		state.hours = null;
		await tickAt(0);
		state.pressure = "warn";
		await tickAt(4);
		expect(stopped).toEqual([]);
		await tickAt(5);
		expect(stopped).toEqual(["job 110,111"]);
		expect((await watch.view()).stops.map(stop => [stop.owner.kind, stop.because])).toEqual([["process", "warn"]]);
	});

	test("a server that first sees a session idle counts from its file's last write, and one it first sees busy from now", async () => {
		const { state, stopped, tickAt } = computer([]);
		state.minutes = null;
		state.written.set("a", minutes(-23 * 60));
		state.written.set("b", minutes(-48 * 60));
		await tickAt(0);
		await tickAt(59);
		expect(stopped).toEqual([]);
		await tickAt(60);
		expect(stopped).toEqual(["session a"]);
		state.sessions = [{ ...B, status: "idle" }];
		await tickAt(24 * 60 - 1);
		expect(stopped).toEqual(["session a"]);
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

	test("lists within LIST_REUSE_MS of a sample share it, a stop and a later list read anew", async () => {
		const { state, watch, processesOf } = computer();
		state.sessions = [{ ...A, status: "working" }, B];
		const ids = async () => (await processesOf("a"))?.map(item => item.id);
		expect(await ids()).toEqual([DEV_ID, BROWSER_ID, API_ID]);
		state.ps = PS.filter(line => line !== DEV && line !== VITE);
		state.now += LIST_REUSE_MS - 1;
		expect(await ids()).toEqual([DEV_ID, BROWSER_ID, API_ID]);
		state.now += 1;
		expect(await ids()).toEqual([BROWSER_ID, API_ID]);
		state.ps = PS;
		expect((await watch.stop("gone", DEV_ID)).find(each => each.instanceId === "a")?.processes.map(item => item.id)).toEqual([DEV_ID, BROWSER_ID, API_ID]);
		expect(await ids()).toEqual([DEV_ID, BROWSER_ID, API_ID]);
	});
});
