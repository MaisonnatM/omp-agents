import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopTree } from "./process-census";

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
