import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRunning, OwnerLock } from "./owner-lock";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function lockFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-lock-"));
	dirs.push(dir);
	return join(dir, "config", "server.lock");
}

/** Server `port` as process `pid`, with `alive` the processes that run. */
const server = (file: string, port: number, pid: number, alive: number[]) => new OwnerLock(file, port, other => alive.includes(other), pid);

describe("OwnerLock", () => {
	test("the first server owns the work, and one beside it waits and learns who owns it", () => {
		const file = lockFile();
		const alive = [100, 200];
		const first = server(file, 4000, 100, alive);
		const second = server(file, 5000, 200, alive);
		expect(first.acquire()).toBe(true);
		expect(second.acquire()).toBe(false);
		expect(second.holder()).toEqual({ pid: 100, port: 4000 });
		expect(first.acquire()).toBe(true);
		expect(readdirSync(join(file, ".."))).toEqual(["server.lock"]);
	});

	test("the waiting server takes over once the owner released the lock or exited without releasing it", () => {
		const file = lockFile();
		const alive = [100, 200];
		const first = server(file, 4000, 100, alive);
		const second = server(file, 5000, 200, alive);
		first.acquire();
		first.release();
		expect(existsSync(file)).toBe(false);
		expect(second.acquire()).toBe(true);

		const third = server(file, 6000, 300, [200, 300]);
		expect(third.acquire()).toBe(false);
		// Process 200 is gone without releasing.
		const retaken = server(file, 6000, 300, [300]);
		expect(retaken.acquire()).toBe(true);
		expect(retaken.holder()).toEqual({ pid: 300, port: 6000 });
	});

	test("a lock that is not a holder's record is stale", () => {
		const file = lockFile();
		const first = server(file, 4000, 100, [100]);
		first.acquire();
		first.release();
		writeFileSync(file, "{not json");
		expect(first.acquire()).toBe(true);
		expect(first.holder()).toEqual({ pid: 100, port: 4000 });
	});

	test("a server whose lock was taken behind its back stops owning the work, and does not delete the new owner's lock on release", () => {
		const file = lockFile();
		const alive = [100, 200];
		const first = server(file, 4000, 100, alive);
		first.acquire();
		writeFileSync(file, JSON.stringify({ pid: 200, port: 5000 }));
		expect(first.acquire()).toBe(false);
		first.release();
		expect(server(file, 5000, 200, alive).holder()).toEqual({ pid: 200, port: 5000 });
	});

	test("isRunning tells this process from one that does not exist", () => {
		expect(isRunning(process.pid)).toBe(true);
		expect(isRunning(2 ** 22 + 12345)).toBe(false);
	});
});
