import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEAVY = join(import.meta.dir, "agent", "scripts", "heavy.py");
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-heavy-"));
	dirs.push(dir);
	return dir;
}

/**
 * Runs `heavy.py` with its slots in `dir`; the command logs its start and end to `dir/log` around a real one-second
 * hold of its slot, which is what a second command must wait out, and prints `started` once it holds the slot.
 */
function heavy(dir: string, slots: number, name: string) {
	const log = join(dir, "log");
	const command = `echo start ${name} >> '${log}'; echo started; sleep 1; echo end ${name} >> '${log}'`;
	return Bun.spawn(["python3", HEAVY, command], {
		env: { ...process.env, OMP_HEAVY_SLOT: "", OMP_HEAVY_SLOTS: String(slots), OMP_HEAVY_DIR: join(dir, "slots") },
		stdout: "pipe",
		stderr: "pipe",
	});
}

function logLines(dir: string): string[] {
	const log = join(dir, "log");
	return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

/** Resolves once the command prints `started`, so the next one is spawned while it holds its slot. */
async function started(stdout: ReadableStream<Uint8Array>): Promise<void> {
	const { value } = await stdout.getReader().read();
	expect(new TextDecoder().decode(value)).toBe("started\n");
}

test("with one slot, a second heavy command waits for the first and says it is queued", async () => {
	const dir = scratch();
	const first = heavy(dir, 1, "a");
	await started(first.stdout);
	const second = heavy(dir, 1, "b");
	expect(await Promise.all([first.exited, second.exited])).toEqual([0, 0]);
	expect(logLines(dir)).toEqual(["start a", "end a", "start b", "end b"]);
	const waited = await new Response(second.stderr).text();
	expect(waited).toContain("heavy: queued, all 1 heavy slots are busy");
	expect(waited).toMatch(/slot 1: pid \d+: echo start a/);
	expect(waited).toContain("heavy: got slot 1 after");
	expect(await new Response(first.stderr).text()).toBe("");
});

test("with two slots, two heavy commands run at once", async () => {
	const dir = scratch();
	const first = heavy(dir, 2, "a");
	await started(first.stdout);
	const second = heavy(dir, 2, "b");
	expect(await Promise.all([first.exited, second.exited])).toEqual([0, 0]);
	expect(logLines(dir).slice(0, 2)).toEqual(["start a", "start b"]);
	expect(await new Response(second.stderr).text()).toBe("");
});

test("a heavy command inside another runs in its parent's slot, and the command's exit status passes through", async () => {
	const dir = scratch();
	const env = { ...process.env, OMP_HEAVY_SLOT: "", OMP_HEAVY_SLOTS: "1", OMP_HEAVY_DIR: join(dir, "slots") };
	const nested = Bun.spawn(["python3", HEAVY, `python3 '${HEAVY}' sh -c 'exit 3'`], { env, stderr: "pipe" });
	expect(await nested.exited).toBe(3);
	expect(await new Response(nested.stderr).text()).toBe("");
});
