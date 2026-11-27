import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceSample } from "../shared/resources";
import { ResourceHistory } from "./resource-history";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-resources-"));
	dirs.push(dir);
	return dir;
}

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-27T12:00:00Z");

const sample = (at: number): ResourceSample => ({
	at,
	reading: { pressure: "normal", totalBytes: 24, availableBytes: 12, swapUsedBytes: 0, swapOutBytesPerMin: 0, swapOutBytes: 0, calmTicks: 0, at },
	byClass: { session: 1, process: 0, stray: 0, mcp: 0, heavy: 0, dashboard: 2 },
	jetsam: [],
});

const report = (timestamp: string, body: unknown): string => `${JSON.stringify({ bug_type: "298", timestamp })}\n${JSON.stringify(body, null, 2)}`;

describe("ResourceHistory", () => {
	test("read answers the samples of the last hours across day files, oldest first, and skips a cut line", async () => {
		const dir = join(tempDir(), "resources");
		const history = new ResourceHistory(dir, { now: () => NOW, reportsDir: tempDir() });
		for (const at of [NOW - 30 * HOUR, NOW - 13 * HOUR, NOW - HOUR, NOW]) history.append(sample(at));
		writeFileSync(join(dir, "2026-11-27.jsonl"), `{"at":`, { flag: "a" });
		expect((await history.read(24)).map(({ at }) => at)).toEqual([NOW - 13 * HOUR, NOW - HOUR, NOW]);
		expect((await history.read(2)).map(({ at }) => at)).toEqual([NOW - HOUR, NOW]);
	});

	test("the first append of a day deletes the day files older than 14 days", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "2026-11-01.jsonl"), "");
		writeFileSync(join(dir, "2026-11-20.jsonl"), "");
		new ResourceHistory(dir, { now: () => NOW, reportsDir: tempDir() }).append(sample(NOW));
		expect(readdirSync(dir).sort()).toEqual(["2026-11-20.jsonl", "2026-11-27.jsonl"]);
	});

	test("record keeps one sample a minute, each with the Jetsam events since the last kept one", async () => {
		const dir = tempDir();
		const reports = tempDir();
		const history = new ResourceHistory(dir, { now: () => NOW, reportsDir: reports });
		await history.record(sample(NOW - 120_000));
		writeFileSync(join(reports, "JetsamEvent-2026-11-27-115930.ips"), report("2026-11-27 11:59:30.00 +0000", { largestProcess: "bun", processes: [{ reason: "low-swap" }] }));
		await history.record(sample(NOW - 90_000));
		await history.record(sample(NOW - 60_000));
		await history.record(sample(NOW));
		const kept = await history.read(1);
		expect(kept.map(({ at, jetsam }) => [at, jetsam.length])).toEqual([[NOW - 120_000, 0], [NOW - 60_000, 0], [NOW, 1]]);
	});

	test("jetsamSince reads each report's time, largest process, and memory kills, newer than the time asked, and skips what it cannot read", async () => {
		const reports = tempDir();
		writeFileSync(
			join(reports, "JetsamEvent-2026-11-24-114355.ips"),
			report("2026-11-24 11:43:55.00 +0100", { largestProcess: "bun", processes: [{ reason: "low-swap" }, { reason: "idle-exit" }, { reason: "per-process-limit" }, {}] }),
		);
		writeFileSync(join(reports, "JetsamEvent-2026-11-23-095245.000.ips"), report("2026-11-23 09:52:45.00 +0100", { largestProcess: "Google Chrome", processes: [] }));
		writeFileSync(join(reports, "JetsamEvent-2026-11-25-000000.ips"), "not json\n{");
		mkdirSync(join(reports, "JetsamEvent-2026-11-26-000000.ips"));
		writeFileSync(join(reports, "Other-2026-11-25.ips"), report("2026-11-25 00:00:00.00 +0000", { largestProcess: "x", processes: [] }));
		const history = new ResourceHistory(tempDir(), { now: () => NOW, reportsDir: reports });
		const nov24 = Date.parse("2026-11-24T10:43:55Z");
		expect(await history.jetsamSince(0)).toEqual([
			{ at: Date.parse("2026-11-23T08:52:45Z"), largestProcess: "Google Chrome", killed: 0 },
			{ at: nov24, largestProcess: "bun", killed: 2 },
		]);
		expect(await history.jetsamSince(nov24)).toEqual([]);
	});

	test("jetsamSince answers none when the reports folder is missing", async () => {
		const missing = join(tempDir(), "gone");
		expect(existsSync(missing)).toBe(false);
		expect(await new ResourceHistory(tempDir(), { reportsDir: missing }).jetsamSince(0)).toEqual([]);
	});
});
