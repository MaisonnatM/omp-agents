/** One place that runs a subprocess to completion and reads its output. */

export interface RunOptions {
	cwd?: string;
	/** Written to the child's stdin; without it stdin is closed. */
	input?: string;
	/** Kills the child after this long. */
	timeoutMs?: number;
	/** Added to this process's environment. */
	env?: Record<string, string>;
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
		env: opts.env ? { ...process.env, ...opts.env } : undefined,
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
 * Runs `command` through `sh -c` in `cwd` and settles when it exits, whatever its exit code. Rejects only when it cannot spawn.
 * Its stderr goes into its output in order with stdout; output past `maxOutput` keeps its end, after `…`.
 */
export async function runShell(command: string, cwd: string, opts: ShellOptions): Promise<ShellResult> {
	const child = Bun.spawn(["/bin/sh", "-c", `exec 2>&1\n${command}`], { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true });
	// The command's own children keep the pipe open after `sh` dies, so stopping it signals its whole process group.
	const stop = (): void => {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// Every process in the group already exited.
		}
	};
	const timer = setTimeout(stop, opts.timeoutMs);
	opts.signal?.addEventListener("abort", stop);
	try {
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
 * Runs `argv` and parses stdout as JSON. The exit code does not matter when stdout parses, as with `gh api graphql`
 * answering errors in JSON; otherwise @throws Error as {@link runChecked} does.
 */
export async function runJson(argv: string[], opts?: RunOptions): Promise<unknown> {
	const { stdout, stderr, code } = await run(argv, opts);
	try {
		return JSON.parse(stdout);
	} catch {
		throw new Error(stderr.split("\n").findLast(line => line.trim())?.trim() || `${argv[0]} exited ${code}`);
	}
}
