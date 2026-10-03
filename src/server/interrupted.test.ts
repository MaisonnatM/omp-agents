import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { InterruptedSessions } from "./interrupted";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileIn(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-interrupted-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "interrupted.json");
}

describe("InterruptedSessions", () => {
	test("the sessions that ran when the server went down are interrupted at its next start", () => {
		const path = fileIn();
		new InterruptedSessions(path).setRunning(new Map([["a", false], ["b", false]]));
		// The server died without another write.
		const next = new InterruptedSessions(path);
		expect([next.has("a"), next.has("b"), next.has("c")]).toEqual([true, true, false]);
		// Its own restart does not count them twice, nor forget them.
		expect(new InterruptedSessions(path).has("a")).toBe(true);
	});

	test("a session that stopped while the server ran stays interrupted across a restart, until it runs again", () => {
		const path = fileIn();
		const tracker = new InterruptedSessions(path);
		tracker.setRunning(new Map([["a", false]]));
		tracker.interrupt("a");
		tracker.setRunning(new Map());
		expect(new InterruptedSessions(path).has("a")).toBe(true);

		tracker.setRunning(new Map([["a", false]]));
		expect(tracker.has("a")).toBe(false);
		// It still runs, so the next start would read it as interrupted again; End session clears it from the running list.
		tracker.setRunning(new Map());
		expect(new InterruptedSessions(path).has("a")).toBe(false);
	});

	test("a session keeps whether its turn ran when it stopped, across a crash and a restart", () => {
		const path = fileIn();
		const tracker = new InterruptedSessions(path);
		tracker.setRunning(new Map([["busy", false], ["calm", false], ["exited", false]]));
		// A turn that starts is saved at once, so a crash right after still knows it.
		tracker.setRunning(new Map([["busy", true], ["calm", false], ["exited", true]]));
		tracker.interrupt("exited");
		tracker.setRunning(new Map([["busy", true], ["calm", false]]));
		// The server died without another write.
		const next = new InterruptedSessions(path);
		expect(["busy", "calm", "exited"].map(id => next.stoppedMidTurn(id))).toEqual([true, false, true]);
		expect(new InterruptedSessions(path).stoppedMidTurn("busy")).toBe(true);

		// Resumed, it is no longer interrupted, whatever its turn did before.
		next.setRunning(new Map([["busy", false]]));
		expect(next.stoppedMidTurn("busy")).toBe(false);
	});

	test("a list written before turns were tracked reads its sessions as idle", () => {
		const path = fileIn();
		mkdirSync(dirname(path));
		writeFileSync(path, '{"running": ["a"], "interrupted": ["b"]}');
		const tracker = new InterruptedSessions(path);
		expect([tracker.has("a"), tracker.has("b"), tracker.stoppedMidTurn("a"), tracker.stoppedMidTurn("b")]).toEqual([true, true, false, false]);
	});

	test("a dismissed session moves to the past sessions for good", () => {
		const path = fileIn();
		const tracker = new InterruptedSessions(path);
		tracker.interrupt("a");
		expect(tracker.dismiss("a")).toBe(true);
		expect(tracker.dismiss("a")).toBe(false);
		expect(new InterruptedSessions(path).has("a")).toBe(false);
	});

	test("a file that is not a list of sessions reads as none", () => {
		const path = fileIn();
		new InterruptedSessions(path).interrupt("a");
		writeFileSync(path, '{"running": "a"}');
		expect(new InterruptedSessions(path).has("a")).toBe(false);
	});
});
