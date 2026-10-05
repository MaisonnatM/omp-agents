import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HOME = homedir();

const configDir = join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "omp-agents");

/** Where the dashboard keeps its access token: `$XDG_CONFIG_HOME/omp-agents/token`, else `~/.config/omp-agents/token`. */
export const tokenFile = join(configDir, "token");

/** The sessions this dashboard started that stopped without End session, beside {@link tokenFile}. */
export const interruptedFile = join(configDir, "interrupted.json");

/** The Todo page's list, beside {@link tokenFile}. */
export const userTodosFile = join(configDir, "todos.json");

/**
 * Where omp's `user_todo` tool leaves its changes to the Todo page's list, one JSON file each, beside {@link tokenFile}.
 * The server applies and deletes them, so it stays the only writer of {@link userTodosFile}.
 */
export const userTodoInboxDir = join(configDir, "todo-inbox");

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
