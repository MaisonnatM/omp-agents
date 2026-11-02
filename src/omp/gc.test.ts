import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecked } from "../proc";
import { GC_PHASES } from "../shared/storage";
import { parseGcAnswer } from "./gc";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("native reports must contain every requested phase and the requested mode", () => {
	const report = { apply: false, blobs: { wouldDelete: 2, deleted: 0, bytes: 4000, errors: ["one file was unreadable"] } };
	expect(parseGcAnswer(report, ["blobs"], false)).toEqual(report);
	expect(() => parseGcAnswer(report, GC_PHASES, false)).toThrow("incomplete");
	expect(() => parseGcAnswer(report, ["blobs"], true)).toThrow("incomplete");
	expect(() => parseGcAnswer({ ...report, blobs: { ...report.blobs, errors: "failed" } }, ["blobs"], false)).toThrow("incomplete");
});

test("native gc previews all phases, applies one phase in isolation, and refuses a live cleanup lock", async () => {
	const root = mkdtempSync(join(tmpdir(), "omp-storage-test-"));
	roots.push(root);
	const agent = join(root, "agent");
	const blobs = join(agent, "blobs");
	mkdirSync(blobs, { recursive: true });
	const old = join(blobs, `${"a".repeat(64)}.txt`);
	const recent = join(blobs, `${"b".repeat(64)}.txt`);
	writeFileSync(old, "old attachment");
	writeFileSync(recent, "still being written");
	const yesterday = new Date(Date.now() - 86_400_000);
	utimesSync(old, yesterday, yesterday);
	const output = await runChecked([process.execPath, "-e", `
		import { gcPreview, gcApply, CleanupBusy } from ${JSON.stringify(import.meta.resolve("./gc.ts"))};
		const preview = await gcPreview();
		if (!await Bun.file(${JSON.stringify(old)}).exists()) throw new Error("The dry run deleted a file");
		const applied = await gcApply("blobs");
		const lock = ${JSON.stringify(join(agent, "gc.lock"))};
		await Bun.write(lock, process.pid + "\\n" + new Date().toISOString() + "\\n");
		let busy = false;
		try { await gcPreview(); } catch (error) { busy = error instanceof CleanupBusy; }
		if (!busy) throw new Error("A live native cleanup lock was not reported as busy");
		if (!await Bun.file(lock).exists()) throw new Error("The live cleanup lock was removed");
		await Bun.file(lock).delete();
		console.log(JSON.stringify({ preview, applied }));
	`], { env: { PI_CODING_AGENT_DIR: agent, OMP_WORKTREE_DIR: join(root, "wt"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data") }, timeoutMs: 60_000 });
	const { preview, applied } = JSON.parse(output);
	expect(Object.keys(preview)).toEqual(expect.arrayContaining(GC_PHASES));
	expect(preview.blobs.wouldDelete).toBe(1);
	expect(preview.apply).toBe(false);
	expect(applied.apply).toBe(true);
	expect(applied.blobs.deleted).toBe(1);
	for (const phase of GC_PHASES.filter(phase => phase !== "blobs")) expect(applied[phase]).toBeUndefined();
	expect(existsSync(old)).toBe(false);
	expect(existsSync(recent)).toBe(true);
}, 90_000);
