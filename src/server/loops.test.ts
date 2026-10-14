import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LoopHandlers, Loops, repeat } from "./loops";

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	jest.useRealTimers();
});

/** Lets every promise reaction that is already queued, and the ones it queues in turn, run. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** Handlers that note each call in `calls`, and ask for a re-read on every file change. */
function recording(calls: string[]): LoopHandlers {
	const tick = (name: string) => async () => void calls.push(name);
	return {
		onRegistryTick: tick("registry"),
		onFileChange: path => {
			calls.push(`changed ${path}`);
			return true;
		},
		onListRefresh: tick("list"),
		onRescanTick: tick("rescan"),
		onUsageTick: tick("usage"),
		onMinuteTick: tick("minute"),
		onNoticeTick: tick("notice"),
		onActivityTick: tick("activity"),
		onPullTick: tick("pull"),
	};
}

describe("repeat", () => {
	test("a tick that throws or rejects is logged with the loop's name, and the loop runs again", async () => {
		jest.useFakeTimers();
		const logged = spyOn(console, "error").mockImplementation(() => {});
		let runs = 0;
		stops.push(
			repeat(
				"usage",
				async () => {
					runs++;
					if (runs === 1) throw new Error("no usage");
					if (runs === 2) return Promise.reject(new Error("still no usage"));
				},
				100,
			),
		);
		for (let turn = 0; turn < 3; turn++) {
			jest.advanceTimersByTime(100);
			await settle();
		}
		expect(runs).toBe(3);
		expect(logged.mock.calls.map(([line]) => line)).toEqual(["omp-agents: the usage loop failed: no usage", "omp-agents: the usage loop failed: still no usage"]);
		logged.mockRestore();
	});

	test("the next tick is scheduled once the last one finished, so ticks never overlap", async () => {
		jest.useFakeTimers();
		const finish: (() => void)[] = [];
		let running = 0;
		let starts = 0;
		stops.push(
			repeat(
				"rescan",
				async () => {
					starts++;
					running++;
					await new Promise<void>(resolve => finish.push(resolve));
					running--;
				},
				100,
			),
		);
		jest.advanceTimersByTime(100);
		await settle();
		jest.advanceTimersByTime(1000);
		await settle();
		expect([starts, running]).toEqual([1, 1]);

		finish[0]?.();
		await settle();
		jest.advanceTimersByTime(99);
		await settle();
		expect(starts).toBe(1);
		jest.advanceTimersByTime(1);
		await settle();
		expect(starts).toBe(2);
	});

	test("the first tick waits for its own delay, and a stopped loop does not run again", async () => {
		jest.useFakeTimers();
		let runs = 0;
		const stop = repeat(
			"registry",
			async () => {
				runs++;
			},
			100,
			0,
		);
		jest.advanceTimersByTime(0);
		await settle();
		expect(runs).toBe(1);
		stop();
		jest.advanceTimersByTime(1000);
		await settle();
		expect(runs).toBe(1);
	});
});

describe("Loops", () => {
	test("stop ends every loop, the watcher, and a pending re-read, and ignores what is reported after it", async () => {
		jest.useFakeTimers();
		const dir = mkdtempSync(join(tmpdir(), "omp-loops-"));
		const calls: string[] = [];
		const loops = new Loops([{ root: dir, createRoot: true }], recording(calls));
		try {
			loops.watch();
			loops.start();
			loops.fileChanged(join(dir, "a.jsonl"));
			loops.stop();
			loops.fileChanged(join(dir, "b.jsonl"));
			await loops.listNow();
			jest.advanceTimersByTime(24 * 60 * 60_000);
			await settle();
			expect(calls).toEqual([`changed ${join(dir, "a.jsonl")}`]);
		} finally {
			loops.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a sessions directory another agent has not made is neither made nor a failure", () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-loops-"));
		const missing = join(dir, "claude", "projects");
		const loops = new Loops([{ root: join(dir, "omp"), createRoot: true }, { root: missing, createRoot: false }], recording([]));
		try {
			expect(() => loops.watch()).not.toThrow();
			expect(existsSync(join(dir, "omp"))).toBe(true);
			expect(existsSync(missing)).toBe(false);
		} finally {
			loops.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
