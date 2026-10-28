import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { descendants, parseListeners, parsePs, sessionGroups, stopTree } from "./process-census";

/** omp (100) with an MCP server in its process group, two jobs, and a shared worker it spawned, which has a child of its own. */
const PS = `
  100     1   100  51200   3.5 Fri Oct  3 09:00:00 2026     omp
  101   100   100  20480   0.4 Fri Oct  3 09:00:01 2026     node mcp-server.js --stdio
  110   100   110   4096   0.0 Fri Oct  3 09:10:00 2026     bun run dev
  111   110   110 102400 112.5 Fri Oct  3 09:10:01 2026     node vite.js
  120   100   120   1024   0.0 Fri Oct  3 09:20:00 2026     sleep 600
  130   100   130   8192   1.0 Fri Oct  3 09:05:00 2026     /opt/bun __omp_worker_daemon_broker
  131   130   131   8192   0.0 Fri Oct  3 09:30:00 2026     python3 -m http.server
  200     1   200   2048   0.0 Fri Oct  3 08:00:00 2026     -zsh
not a process line
`;

test("ps's table reads each process with its group, memory, CPU, start, and command", () => {
	const table = parsePs(PS);
	expect(table.size).toBe(8);
	expect(table.get(101)).toEqual({ pid: 101, ppid: 100, pgid: 100, started: "Fri Oct 3 09:00:01 2026", rssKb: 20480, cpuPercent: 0.4, command: "node mcp-server.js --stdio" });
	expect(table.get(111)?.cpuPercent).toBe(112.5);
});

test("the processes under omp leave out its shared workers and what they started, so the keeper never notes them", () => {
	expect([...descendants(parsePs(PS), 100)]).toEqual([
		[101, "Fri Oct 3 09:00:01 2026"],
		[110, "Fri Oct 3 09:10:00 2026"],
		[120, "Fri Oct 3 09:20:00 2026"],
		[111, "Fri Oct 3 09:10:01 2026"],
	]);
});

test("a session's groups are omp's own group and one job per other group under it", () => {
	const groups = sessionGroups(parsePs(PS), 100);
	expect(groups && groups.omp.map(row => row.pid)).toEqual([100, 101]);
	expect(groups && [...groups.jobs].map(([pgid, rows]) => [pgid, rows.map(row => row.pid)])).toEqual([
		[110, [110, 111]],
		[120, [120]],
	]);
	expect(sessionGroups(parsePs(PS), 999)).toBeNull();
});

test("lsof's listeners read as each pid's ports, sorted and unique across IPv4 and IPv6", () => {
	const lsof = ["p111", "f23", "n*:5173", "f24", "n[::1]:5173", "f25", "n127.0.0.1:24678", "p300", "f9", "n127.0.0.1:9222", ""].join("\n");
	expect([...parseListeners(lsof)]).toEqual([
		[111, [5173, 24678]],
		[300, [9222]],
	]);
	expect(parseListeners("").size).toBe(0);
});

/** A root that exits on SIGTERM, with a child that ignores it, which prints its pid once it ignores it. */
const ROOT = `
const child = Bun.spawn(["sh", "-c", "trap '' TERM; echo ready; exec sleep 61"], { stdout: "pipe" });
await child.stdout.getReader().read();
process.on("SIGTERM", () => process.exit(0));
console.log(child.pid);
setInterval(() => {}, 1_000);
`;

const dirs: string[] = [];
afterEach(() => {
	mock.restore();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a tree's root that exits on SIGTERM gets no SIGKILL, and the child that ignores SIGTERM does", async () => {
	const dir = mkdtempSync(join("/tmp", "opc-"));
	dirs.push(dir);
	writeFileSync(join(dir, "root.ts"), ROOT);
	const root = Bun.spawn([process.execPath, join(dir, "root.ts")], { stdout: "pipe" });
	const child = Number(new TextDecoder().decode((await root.stdout.getReader().read()).value));
	const sent: string[] = [];
	const kill = process.kill.bind(process);
	spyOn(process, "kill").mockImplementation((pid, name) => {
		if (pid === root.pid || pid === child) sent.push(`${pid === root.pid ? "root" : "child"} ${String(name)}`);
		return kill(pid, name);
	});

	await stopTree(root.pid, 500);
	await root.exited;
	expect(sent).toEqual(["root SIGTERM", "child SIGTERM", "child SIGKILL"]);
	expect(Bun.spawnSync(["ps", "-o", "pid=", "-p", String(child)]).stdout.toString().trim()).toBe("");
});
