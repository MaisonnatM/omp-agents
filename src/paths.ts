import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HOME = homedir();

/** `path` with the home directory shortened to `~`. */
export const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;

/** The directory `input` names (absolute, `~`-relative, or relative to the home directory), or `null` when it is not one. */
export function directoryOf(input: string): string | null {
	const raw = input.trim();
	const cwd = raw === "~" || raw.startsWith("~/") ? join(HOME, raw.slice(1)) : resolve(HOME, raw);
	try {
		return statSync(cwd).isDirectory() ? cwd : null;
	} catch {
		return null;
	}
}
