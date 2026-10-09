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
/** Where omp's `end_session` tool asks the server to end a session, one `<session id>.json` each, beside {@link tokenFile}. */
export const sessionEndInboxDir = join(configDir, "end-inbox");
/** The routines, their runs, and the pull request heads their sessions took, beside {@link tokenFile}. */
export const routinesFile = join(configDir, "routines.json");
/** The directories Settings → Projects added and hid, beside {@link tokenFile}. */
export const projectsFile = join(configDir, "projects.json");
/** The sessions the sidebar pins, beside {@link tokenFile}. */
export const pinsFile = join(configDir, "pins.json");
/** The Google calendars the Calendar page's sidebar unchecked, beside {@link tokenFile}. */
export const calendarsFile = join(configDir, "calendars.json");
/** The notices the bell's user saw or cleared, beside {@link tokenFile}. */
export const noticesFile = join(configDir, "notices.json");
/** The Google calendars' secret addresses an older version kept, beside {@link tokenFile}; the server deletes it at startup. */
export const oldGoogleFile = join(configDir, "google.json");
/** Names the server that runs routines and applies the todo inbox, which servers side by side share, beside {@link tokenFile}. */
export const serverLockFile = join(configDir, "server.lock");

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
