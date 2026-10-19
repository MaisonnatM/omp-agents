import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flushJsonFiles } from "../fs";
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

/** A server starting over `path`, which attached to the sessions `survived` names. */
function started(path: string, survived: string[] = []): InterruptedSessions {
	const tracker = new InterruptedSessions(path);
	tracker.recover(new Set(survived));
	return tracker;
}

describe("InterruptedSessions", () => {
	test("the sessions that ran when the server went down and did not survive it are interrupted at its next start", () => {
		const path = fileIn();
		started(path).setRunning(new Map([["a", false], ["b", false]]));
		// The server died without another write, and neither keeper outlived it.
		const next = started(path);
		expect([next.has("a"), next.has("b"), next.has("c")]).toEqual([true, true, false]);
		expect([next.stoppedWithServer("a"), next.stoppedWithServer("c")]).toEqual([true, false]);
		flushJsonFiles();
		// Its own restart does not count them twice, nor forget them.
		const again = started(path);
		expect([again.has("a"), again.stoppedWithServer("a")]).toEqual([true, false]);
	});

	test("a session the next server attached to runs on: it is neither interrupted nor stopped with the server", () => {
		const path = fileIn();
		started(path).setRunning(new Map([["kept", true], ["lost", true]]));
		const next = started(path, ["kept"]);
		expect([next.has("kept"), next.stoppedWithServer("kept"), next.stoppedMidTurn("kept")]).toEqual([false, false, false]);
		expect([next.has("lost"), next.stoppedWithServer("lost"), next.stoppedMidTurn("lost")]).toEqual([true, true, true]);
		next.setRunning(new Map([["kept", false]]));
		flushJsonFiles();
		// It still runs when this server goes down too, and the server after it attaches to it again.
		expect(started(path, ["kept"]).has("kept")).toBe(false);
	});

	test("what sessions report while they attach leaves alone what the last server left running", () => {
		const path = fileIn();
		started(path).setRunning(new Map([["kept", false], ["lost", true]]));
		const next = new InterruptedSessions(path);
		// The first attached session reports before the others attached, and before the server knows which survived.
		next.setRunning(new Map([["kept", true]]));
		next.recover(new Set(["kept"]));
		expect([next.has("lost"), next.stoppedMidTurn("lost"), next.stoppedWithServer("lost")]).toEqual([true, true, true]);
	});

	test("a session that stopped while the server ran stays interrupted across a restart, until it runs again", () => {
		const path = fileIn();
		const tracker = started(path);
		tracker.setRunning(new Map([["a", false]]));
		tracker.interrupt("a");
		tracker.setRunning(new Map());
		expect(started(path).has("a")).toBe(true);

		tracker.setRunning(new Map([["a", false]]));
		expect(tracker.has("a")).toBe(false);
		// End session takes it out of the running list, so the next start does not read it as interrupted.
		tracker.setRunning(new Map());
		expect(started(path).has("a")).toBe(false);
	});

	test("a session keeps whether its turn ran when it stopped, across a crash and a restart", () => {
		const path = fileIn();
		const tracker = started(path);
		tracker.setRunning(new Map([["busy", false], ["calm", false], ["exited", false]]));
		// A turn that starts is saved at once, so a crash right after still knows it.
		tracker.setRunning(new Map([["busy", true], ["calm", false], ["exited", true]]));
		tracker.interrupt("exited");
		tracker.setRunning(new Map([["busy", true], ["calm", false]]));
		// The server died without another write.
		const next = started(path);
		expect(["busy", "calm", "exited"].map(id => next.stoppedMidTurn(id))).toEqual([true, false, true]);
		expect(started(path).stoppedMidTurn("busy")).toBe(true);

		// Resumed, it is no longer interrupted, whatever its turn did before.
		next.setRunning(new Map([["busy", false]]));
		expect(next.stoppedMidTurn("busy")).toBe(false);
	});

	test("a list written before turns were tracked reads its sessions as idle", () => {
		const path = fileIn();
		mkdirSync(dirname(path));
		writeFileSync(path, '{"running": ["a"], "interrupted": ["b"]}');
		const tracker = started(path);
		expect([tracker.has("a"), tracker.has("b"), tracker.stoppedMidTurn("a"), tracker.stoppedMidTurn("b")]).toEqual([true, true, false, false]);
	});

	test("a dismissed session moves to the past sessions for good", () => {
		const path = fileIn();
		const tracker = started(path);
		tracker.interrupt("a");
		expect(tracker.dismiss("a")).toBe(true);
		expect(tracker.dismiss("a")).toBe(false);
		expect(started(path).has("a")).toBe(false);
	});

	test("a file that is not a list of sessions reads as none", () => {
		const path = fileIn();
		started(path).interrupt("a");
		flushJsonFiles();
		writeFileSync(path, '{"running": "a"}');
		expect(started(path).has("a")).toBe(false);
	});
});
