/** One place that runs a subprocess to completion and reads its output. */
import { CommandError, parsedAnswer } from "../templates/omp/agent/extensions/github/command";

/**
 * What the server sets for itself: a dev server an agent or a terminal starts would take the dashboard's `PORT`, and
 * the desktop shell's `OMP_AGENTS_PARENT` would make a smoke server an agent starts exit as soon as its stdin ends.
 */
const SERVER_ENV = ["PORT", "OMP_AGENTS_PARENT"];

/** This process's environment without what the server sets for itself, for the omp sessions, shells, and routine commands it starts. */
export function childEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env, ...extra };
	for (const name of SERVER_ENV) delete env[name];
	return env;
}

export interface RunOptions {
	cwd?: string;
	/** Written to the child's stdin; without it stdin is closed. */
	input?: string;
	/** Kills the child after this long. */
	timeoutMs?: number;
	/** Added to this process's environment. */
	env?: Record<string, string>;
	/** Leaves out what the server sets for itself, as {@link childEnv} does, for a command that may start a server of its own, such as a git hook. */
	child?: boolean;
	/** Stops the subprocess on abort. */
	signal?: AbortSignal;
}

export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** Runs `argv` (no shell) and settles when it exits, whatever its exit code. Rejects only when it cannot spawn. */
export async function run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
	opts.signal?.throwIfAborted();
	const child = Bun.spawn(argv, {
		cwd: opts.cwd,
		stdin: opts.input === undefined ? "ignore" : new Blob([opts.input]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: opts.timeoutMs,
		// Bun's default is the environment this process started with, which misses a variable set since, such as the test environment's scratch omp directory.
		env: opts.child ? childEnv(opts.env) : { ...process.env, ...opts.env },
	});
	const stop = (): void => { child.kill(); };
	opts.signal?.addEventListener("abort", stop, { once: true });
	try {
		if (opts.signal?.aborted) stop();
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		opts.signal?.throwIfAborted();
		return { stdout, stderr, code };
	} finally {
		opts.signal?.removeEventListener("abort", stop);
	}
}

export interface ShellOptions {
	/** Stops the command after this long. */
	timeoutMs: number;
	/** The output characters kept, the last ones. */
	maxOutput: number;
	/** Stops the command when it aborts. */
	signal?: AbortSignal;
}

/** What a shell command ended with: `exitCode` is null once it was stopped. */
export interface ShellResult {
	exitCode: number | null;
	output: string;
}

/**
 * Runs `command` through `sh -c` in `cwd` and settles when it exits, whatever its exit code. Rejects if already aborted or unable to spawn.
 * Its stderr goes into its output in order with stdout; output past `maxOutput` keeps its end, after `…`.
 */
export async function runShell(command: string, cwd: string, opts: ShellOptions): Promise<ShellResult> {
	opts.signal?.throwIfAborted();
	const child = Bun.spawn(["/bin/sh", "-c", `exec 2>&1\n${command}`], { cwd, env: childEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true });
	// The command's own children keep the pipe open after `sh` dies, so stopping it signals its whole process group.
	const stop = (): void => {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// Every process in the group already exited.
		}
	};
	const timer = setTimeout(stop, opts.timeoutMs);
	opts.signal?.addEventListener("abort", stop, { once: true });
	try {
		if (opts.signal?.aborted) stop();
		let output = "";
		let cut = false;
		const keep = (text: string): void => {
			output += text;
			if (output.length <= opts.maxOutput) return;
			output = output.slice(-opts.maxOutput);
			cut = true;
		};
		const decoder = new TextDecoder();
		for await (const chunk of child.stdout) keep(decoder.decode(chunk, { stream: true }));
		keep(decoder.decode());
		await child.exited;
		return { exitCode: child.signalCode ? null : child.exitCode, output: cut ? `…${output}` : output };
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener("abort", stop);
	}
}

/** @throws Error with the last non-empty stderr line, else `<argv[0]> exited <code>`, when the command exits non-zero. */
export async function runChecked(argv: string[], opts?: RunOptions): Promise<string> {
	const { stdout, stderr, code } = await run(argv, opts);
	if (code !== 0) throw new Error(stderr.split("\n").findLast(line => line.trim())?.trim() || `${argv[0]} exited ${code}`);
	return stdout;
}

/**
 * Runs `argv` and parses stdout as JSON.
 * @throws CommandError when the command exits non-zero, even beside parseable stdout, so a caller never mistakes a failed read's partial output for an answer; its `answer` is that stdout parsed, when it parses. Error as {@link runChecked} does when a successful command's stdout does not parse.
 */
export async function runJson(argv: string[], opts?: RunOptions): Promise<unknown> {
	const { stdout, stderr, code } = await run(argv, opts);
	const failure = stderr.split("\n").findLast(line => line.trim())?.trim() || `${argv[0]} exited ${code}`;
	if (code !== 0) throw new CommandError(failure, parsedAnswer(stdout));
	try {
		return JSON.parse(stdout);
	} catch {
		throw new Error(failure);
	}
}
