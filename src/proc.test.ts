import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandError } from "../templates/omp/agent/extensions/github/command";
import { run, runJson, runShell } from "./proc";

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

	test("a pre-aborted command rejects before it can create a file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-pre-abort-"));
		const stopping = new AbortController();
		stopping.abort(new Error("dashboard stopped"));
		try {
			await expect(runShell("touch started", dir, { ...limits, signal: stopping.signal })).rejects.toThrow("dashboard stopped");
			expect(existsSync(join(dir, "started"))).toBe(false);
			expect(await runShell("printf running", dir, limits)).toEqual({ exitCode: 0, output: "running" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rejects when it cannot start in its directory", async () => {
		await expect(runShell("true", "/no/such/directory", limits)).rejects.toThrow("ENOENT");
	});

	test("hides the server's own PORT and OMP_AGENTS_PARENT, so a server the command starts neither takes the dashboard's port nor exits when its stdin ends", async () => {
		const saved = { PORT: process.env.PORT, OMP_AGENTS_PARENT: process.env.OMP_AGENTS_PARENT };
		Object.assign(process.env, { PORT: "4317", OMP_AGENTS_PARENT: "stdin" });
		try {
			expect(await runShell('echo "[$PORT][$OMP_AGENTS_PARENT][$HOME]"', tmpdir(), limits)).toEqual({ exitCode: 0, output: `[][][${process.env.HOME}]\n` });
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});
});

test("run hands the child this process's environment as it is now, such as the test environment's scratch omp directory", async () => {
	expect((await run(["/bin/sh", "-c", 'echo "$PI_CODING_AGENT_DIR"'])).stdout).toBe(`${process.env.PI_CODING_AGENT_DIR}\n`);
	expect((await run(["/bin/sh", "-c", 'echo "$PI_CODING_AGENT_DIR"'], { env: { PI_CODING_AGENT_DIR: "/elsewhere" } })).stdout).toBe("/elsewhere\n");
});

test("run with `child` hides the server's own PORT and keeps what `env` adds", async () => {
	const saved = process.env.PORT;
	process.env.PORT = "4317";
	try {
		expect((await run(["/bin/sh", "-c", 'echo "[$PORT][$EXTRA]"'], { child: true, env: { EXTRA: "kept" } })).stdout).toBe("[][kept]\n");
		expect((await run(["/bin/sh", "-c", 'echo "[$PORT]"'])).stdout).toBe("[4317]\n");
	} finally {
		if (saved === undefined) delete process.env.PORT;
		else process.env.PORT = saved;
	}
});

test("runJson rejects a failed command even when stdout parses, keeping its answer for the caller to classify", async () => {
	const failed = runJson(["/bin/sh", "-c", "printf '{\"body\":\"\"}'; printf 'API rate limit exceeded' >&2; exit 1"]);
	await expect(failed).rejects.toBeInstanceOf(CommandError);
	await expect(failed).rejects.toMatchObject({ message: "API rate limit exceeded", answer: { body: "" } });
});
