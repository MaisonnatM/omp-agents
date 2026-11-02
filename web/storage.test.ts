import { expect, test } from "bun:test";
import type { CleanupStepResult, GcAnswer, SandboxPlan } from "../src/shared/storage";
import { cleanupRows, gcResultText, runCleanup, type CleanupIo, type CleanupRun } from "./storage";

const report: GcAnswer = {
	apply: false,
	stale: { wouldDelete: 2, deleted: 0, bytes: 512, errors: [] },
	blobs: { wouldDelete: 3, deleted: 0, bytes: 1024, errors: [] },
	archive: { wouldArchive: 4, archived: 0, wouldDeleteTemps: 1, deletedTemps: 0, skippedActive: 2, keptNewestGlobal: 20, keptNewestPerCwd: 10, tempBytes: 256, errors: [] },
	compress: { supported: true, wouldCompress: 5, compressed: 0, leftoverScratchDirs: 0, allocatedBefore: 8192, allocatedAfter: 8192, errors: [] },
	wal: { databases: [{ dbPath: "/tmp/history.db", walBytes: 4096, checkpointed: false, busy: 0 }], walBytes: 4096, checkpointed: false },
};
const sandboxes: SandboxPlan[] = [
	{ path: "/tmp/one", kept: null, detail: null, bytes: 1024 },
	{ path: "/tmp/two", kept: null, detail: null, bytes: 1024 },
	{ path: "/tmp/live", kept: "owner-live", detail: "Running", bytes: null },
];
const applyReply: CleanupIo["apply"] = async request => request.step === "sandboxes"
	? { step: "sandboxes", sandboxes: request.sandboxes.map(path => ({ path, kept: null, detail: null })) }
	: { step: request.step, gc: { apply: true, [request.step]: report[request.step] } };

test("cleanup preserves native phase order and does not invent archive or compression savings", () => {
	const rows = cleanupRows(report, [{ path: "/tmp/sandbox", kept: null, detail: null, bytes: 2048 }]);
	expect(rows.map(row => row.step)).toEqual(["stale", "blobs", "archive", "compress", "wal", "sandboxes"]);
	expect(rows[2]).toMatchObject({ label: "Archive cold sessions", count: 5, bytes: 256 });
	expect(rows[2]?.size).toContain("4 sessions");
	expect(rows[3]).toMatchObject({ count: 5, bytes: null });
	expect(rows[3]?.size).toContain("on disk");
	expect(rows[5]).toMatchObject({ bytes: 2048, count: 1, available: true, unit: ["sandbox", "sandboxes"] });
});

test("unknown sandbox sizes stay unknown and kept sandboxes are excluded", () => {
	const rows = cleanupRows(report, [{ path: "/tmp/one", kept: null, detail: null, bytes: null }, { path: "/tmp/live", kept: "owner-live", detail: "Running", bytes: null }]);
	expect(rows[5]).toMatchObject({ bytes: null, count: 1, size: "Size unavailable" });
	expect(cleanupRows(report, null)[5]).toMatchObject({ available: false, size: "Checking…" });
});

test("unsupported compression and a failed volume probe are not actionable", () => {
	const compress = { supported: true, wouldCompress: 5, compressed: 0, leftoverScratchDirs: 0, allocatedBefore: 8192, allocatedAfter: 8192, errors: [] };
	expect(cleanupRows({ ...report, compress: { ...compress, supported: false } }, [])[3]?.available).toBe(false);
	expect(cleanupRows({ ...report, compress: { ...compress, probeFailure: "Read-only volume" } }, [])[3]).toMatchObject({ available: false, detail: "Read-only volume" });
});

test("partial failures keep their error and never claim all selected bytes were freed", () => {
	const result = gcResultText("blobs", { wouldDelete: 2, deleted: 1, bytes: 1024, errors: ["Permission denied"] });
	expect(result.text).toContain("1 of 2");
	expect(result.text).toContain("selected");
	expect(result.errors).toEqual(["Permission denied"]);
	const compressed = gcResultText("compress", { supported: true, wouldCompress: 5, compressed: 2, leftoverScratchDirs: 0, allocatedBefore: 8192, allocatedAfter: 4096, errors: [] });
	expect(compressed.text).toContain("less on disk");
	expect(gcResultText("wal", { databases: [{ dbPath: "/tmp/history.db", walBytes: 4096, checkpointed: false, busy: 1 }], walBytes: 4096, checkpointed: false }).text).toContain("1 busy");
});

test("the driver runs native phases in order, then eligible sandboxes individually, and measures before and after", async () => {
	const applied: string[] = [];
	const readings = [1000, 2000];
	const progress: CleanupRun[] = [];
	const io: CleanupIo = {
		availableBytes: async () => readings.shift() ?? null,
		apply: async request => {
			applied.push(request.step === "sandboxes" ? request.sandboxes.join(",") : request.step);
			return applyReply(request);
		},
	};
	const result = await runCleanup(cleanupRows(report, sandboxes), sandboxes, { stopped: () => false, onProgress: run => progress.push(run) }, io);
	expect(applied).toEqual(["stale", "blobs", "archive", "compress", "wal", "/tmp/one", "/tmp/two"]);
	expect(result).toMatchObject({ phase: "done", before: 1000, after: 2000, stopping: false });
	expect(Object.values(result.progress).every(step => step.state === "done")).toBe(true);
	expect(result.progress.sandboxes?.text).toBe("2 of 2 sandboxes removed");
	expect(Object.values(progress[0]?.progress ?? {}).every(step => step.state === "waiting")).toBe(true);
	expect(progress.some(run => run.progress.sandboxes?.text === "Checking and removing 2 of 2…")).toBe(true);
});

test("a requested stop finishes the current native phase and starts no later phase", async () => {
	let stopped = false;
	const applied: string[] = [];
	const result = await runCleanup(cleanupRows(report, sandboxes), sandboxes, { stopped: () => stopped, onProgress: () => {} }, {
		availableBytes: async () => 1000,
		apply: async request => { applied.push(request.step); stopped = true; return applyReply(request); },
	});
	expect(applied).toEqual(["stale"]);
	expect(result.stopping).toBe(true);
	expect(result.progress.stale?.state).toBe("done");
	expect(result.progress.blobs?.state).toBe("waiting");
});

test("stopping a sandbox phase preserves its partial count and does not remove the next sandbox", async () => {
	let stopped = false;
	const applied: string[] = [];
	const result = await runCleanup(cleanupRows(report, sandboxes).filter(row => row.step === "sandboxes"), sandboxes, { stopped: () => stopped, onProgress: () => {} }, {
		availableBytes: async () => 1000,
		apply: async request => {
			if (request.step === "sandboxes") applied.push(...request.sandboxes);
			stopped = true;
			return applyReply(request);
		},
	});
	expect(applied).toEqual(["/tmp/one"]);
	expect(result.stopping).toBe(true);
	expect(result.progress.sandboxes).toMatchObject({ state: "done", text: "1 of 2 sandboxes removed" });
});

test("a phase's reported errors stop the run and keep later phases waiting", async () => {
	const applied: string[] = [];
	const result = await runCleanup(cleanupRows(report, []).filter(row => row.step === "blobs" || row.step === "archive"), [], { stopped: () => false, onProgress: () => {} }, {
		availableBytes: async () => 1000,
		apply: async request => {
			applied.push(request.step);
			return { step: "blobs", gc: { apply: true, blobs: { wouldDelete: 2, deleted: 1, bytes: 1024, errors: ["Permission denied"] } } };
		},
	});
	expect(applied).toEqual(["blobs"]);
	expect(result.stopping).toBe(true);
	expect(result.progress.blobs).toMatchObject({ state: "failed", errors: ["Permission denied"] });
	expect(result.progress.archive?.state).toBe("waiting");
});

test("a failed command stops the run while unavailable free-space readings remain unknown", async () => {
	const result = await runCleanup(cleanupRows(report, []).filter(row => row.step === "blobs"), [], { stopped: () => false, onProgress: () => {} }, {
		availableBytes: async () => { throw new Error("Cannot measure"); },
		apply: async () => { throw new Error("Disk unavailable"); },
	});
	expect(result).toMatchObject({ before: null, after: null, stopping: true });
	expect(result.progress.blobs).toMatchObject({ state: "failed", errors: ["Disk unavailable"] });
});

test("an unexpected phase or absent native report stops rather than claiming success", async () => {
	const answers: CleanupStepResult[] = [{ step: "archive", gc: { apply: true } }, { step: "blobs", gc: { apply: true } }];
	for (const answer of answers) {
		const result = await runCleanup(cleanupRows(report, []).filter(row => row.step === "blobs"), [], { stopped: () => false, onProgress: () => {} }, {
			availableBytes: async () => 1000,
			apply: async () => answer,
		});
		expect(result.stopping).toBe(true);
		expect(result.progress.blobs).toMatchObject({ state: "failed", errors: ["Unexpected cleanup response."] });
	}
});
