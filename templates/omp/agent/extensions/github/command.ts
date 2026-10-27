import { existsSync } from "node:fs";

/** A command that exited non-zero; `answer` is its stdout parsed as JSON when it parses, such as `gh api`'s error answer beside partial data. */
export class CommandError extends Error {
	constructor(message: string, readonly answer: unknown) {
		super(message);
	}
}

/** `stdout` parsed as JSON, else `undefined`. */
export function parsedAnswer(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return undefined;
	}
}

/** What an extension's `pi.exec` reports of a finished command. */
export interface CommandOutput {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * The `gh` an extension runs: the one on omp's PATH, else Homebrew's. An omp that a GUI app or launchd started can have
 * no Homebrew directory on its PATH, where a bare `gh` fails with ENOENT although the shell finds it.
 */
export const GH = Bun.which("gh") ?? ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find(path => existsSync(path)) ?? "gh";

/** Runs `gh` with `args`, as an extension binds `pi.exec` to its directory and timeout. */
export type Gh = (args: string[]) => Promise<CommandOutput>;

/** `gh args`'s stdout. @throws CommandError with gh's stderr when it exits non-zero, never its stdout, which can be partial data. */
export async function ghText(gh: Gh, args: string[]): Promise<string> {
	const { code, stdout, stderr } = await gh(args);
	if (code !== 0) throw new CommandError(stderr.trim() || `gh exited ${code}`, parsedAnswer(stdout));
	return stdout;
}

/** `gh args`'s stdout parsed as JSON; fails as {@link ghText} does. */
export async function ghJson(gh: Gh, args: string[]): Promise<unknown> {
	return JSON.parse(await ghText(gh, args));
}
