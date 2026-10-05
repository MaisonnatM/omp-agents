import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./proc";

const limits = { timeoutMs: 10_000, maxOutput: 1024 };

describe("runShell", () => {
	test("gives the exit code and stdout and stderr in the order the command wrote them", async () => {
		expect(await runShell("echo out; echo err >&2; echo again; exit 3", tmpdir(), limits)).toEqual({ exitCode: 3, output: "out\nerr\nagain\n" });
	});

	test("runs in its directory", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-proc-")));
		expect(await runShell("pwd -P", dir, limits)).toEqual({ exitCode: 0, output: `${dir}\n` });
	});

	test("keeps the end of output longer than the cap, after a mark", async () => {
		expect(await runShell("printf 'abcdefghijklmnop'", tmpdir(), { ...limits, maxOutput: 5 })).toEqual({ exitCode: 0, output: "…lmnop" });
	});

	// A real child process past a real timer: fake timers do not reach the process group the timer kills.
	test("stops a command past its time limit, with its own children, and gives no exit code", async () => {
		const startedAt = Date.now();
		expect(await runShell("echo started; sleep 5; echo done", tmpdir(), { ...limits, timeoutMs: 200 })).toEqual({ exitCode: null, output: "started\n" });
		expect(Date.now() - startedAt).toBeLessThan(2000);
	});

	test("stops when its signal aborts", async () => {
		const stopping = new AbortController();
		const running = runShell("sleep 5", tmpdir(), { ...limits, signal: stopping.signal });
		stopping.abort();
		expect(await running).toEqual({ exitCode: null, output: "" });
	});

	test("rejects when it cannot start in its directory", async () => {
		await expect(runShell("true", "/no/such/directory", limits)).rejects.toThrow("ENOENT");
	});
});
