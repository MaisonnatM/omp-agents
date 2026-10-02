/** One place that runs a subprocess to completion and reads its output. */

export interface RunOptions {
	cwd?: string;
	/** Written to the child's stdin; without it stdin is closed. */
	input?: string;
	/** Kills the child after this long. */
	timeoutMs?: number;
	/** Added to this process's environment. */
	env?: Record<string, string>;
}

export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** Runs `argv` (no shell) and settles when it exits, whatever its exit code. Rejects only when it cannot spawn. */
export async function run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
	const child = Bun.spawn(argv, {
		cwd: opts.cwd,
		stdin: opts.input === undefined ? "ignore" : new Blob([opts.input]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: opts.timeoutMs,
		env: opts.env ? { ...process.env, ...opts.env } : undefined,
	});
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { stdout, stderr, code };
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
