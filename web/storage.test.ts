import { expect, test } from "bun:test";
import type { GcAnswer } from "../src/shared/storage";
import { cleanupRows, gcResultText } from "./storage";

const report: GcAnswer = {
	apply: false,
	stale: { wouldDelete: 2, deleted: 0, bytes: 512, errors: [] },
	blobs: { wouldDelete: 3, deleted: 0, bytes: 1024, errors: [] },
	archive: { wouldArchive: 4, archived: 0, wouldDeleteTemps: 1, deletedTemps: 0, skippedActive: 2, keptNewestGlobal: 20, keptNewestPerCwd: 10, tempBytes: 256, errors: [] },
	compress: { supported: true, wouldCompress: 5, compressed: 0, leftoverScratchDirs: 0, allocatedBefore: 8192, allocatedAfter: 8192, errors: [] },
	wal: { databases: [{ dbPath: "/tmp/history.db", walBytes: 4096, checkpointed: false, busy: 0 }], walBytes: 4096, checkpointed: false },
};

test("cleanup preserves native phase order and does not invent archive or compression savings", () => {
	const rows = cleanupRows(report, [{ path: "/tmp/sandbox", kept: null, detail: null, bytes: 2048 }]);
	expect(rows.map(row => row.step)).toEqual(["stale", "blobs", "archive", "compress", "wal", "sandboxes"]);
	expect(rows[2]).toMatchObject({ count: 5, bytes: 256 });
	expect(rows[2]?.size).toContain("4 sessions");
	expect(rows[3]).toMatchObject({ count: 5, bytes: null });
	expect(rows[3]?.size).toContain("on disk");
	expect(rows[5]).toMatchObject({ bytes: 2048, count: 1, available: true });
});

test("unknown sandbox sizes stay unknown and kept sandboxes are excluded", () => {
	const rows = cleanupRows(report, [{ path: "/tmp/one", kept: null, detail: null, bytes: null }, { path: "/tmp/live", kept: "owner-live", detail: "Running", bytes: null }]);
	expect(rows[5]).toMatchObject({ bytes: null, count: 1, size: "Size unavailable" });
	expect(cleanupRows(report, null)[5]).toMatchObject({ available: false, size: "Checking…" });
});

test("unsupported compression and a failed volume probe are not actionable", () => {
	expect(cleanupRows({ ...report, compress: { ...report.compress!, supported: false } }, [])[3]?.available).toBe(false);
	expect(cleanupRows({ ...report, compress: { ...report.compress!, probeFailure: "Read-only volume" } }, [])[3]).toMatchObject({ available: false, detail: "Read-only volume" });
});

test("partial failures keep their error and never claim all selected bytes were freed", () => {
	const result = gcResultText("blobs", { apply: true, blobs: { wouldDelete: 2, deleted: 1, bytes: 1024, errors: ["Permission denied"] } });
	expect(result.text).toContain("1 of 2");
	expect(result.text).toContain("selected");
	expect(result.errors).toEqual(["Permission denied"]);
	const compressed = gcResultText("compress", { ...report, apply: true, compress: { ...report.compress!, compressed: 2, allocatedAfter: 4096 } });
	expect(compressed.text).toContain("less on disk");
	expect(gcResultText("wal", { ...report, apply: true }).text).toContain("1 busy");
});
