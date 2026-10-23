import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { portFromEnv } from "./server/address";

export const HOME = homedir();

const configDir = join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "omp-agents");
/** Files the dashboard keeps that the file dialog may open, unlike {@link configDir}: `$XDG_DATA_HOME/omp-agents`, else `~/.local/share/omp-agents`. */
const dataDir = join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "omp-agents");

/** Where the dashboard keeps its access token: `$XDG_CONFIG_HOME/omp-agents/token`, else `~/.config/omp-agents/token`. */
export const tokenFile = join(configDir, "token");

/** The sessions this dashboard started that stopped without End session, beside {@link tokenFile}. */
export const interruptedFile = join(configDir, "interrupted.json");
/**
 * Where the keepers of the sessions the server on `PORT` started listen, a Unix socket and a log each, beside {@link tokenFile}.
 * One directory per port, so a server on another port, such as a smoke run, never takes over this one's sessions.
 */
export const keepersDir = join(configDir, "sessions", String(portFromEnv()));

/** The Todo page's list, beside {@link tokenFile}. */
export const userTodosFile = join(configDir, "todos.json");

/**
 * Where omp's `user_todo` tool leaves its changes to the Todo page's list, one JSON file each, beside {@link tokenFile}.
 * The server applies and deletes them, so it stays the only writer of {@link userTodosFile}.
 */
export const userTodoInboxDir = join(configDir, "todo-inbox");
/** The Notes page's list, beside {@link tokenFile}. */
export const userNotesFile = join(configDir, "notes.json");
/** Where omp's `user_note` tool leaves the notes it adds and appends to, one JSON file each, so the server stays the only writer of {@link userNotesFile}. */
export const userNoteInboxDir = join(configDir, "note-inbox");
/** Where omp's `end_session` tool asks the server to end a session, one `<session id>.json` each, beside {@link tokenFile}. */
export const sessionEndInboxDir = join(configDir, "end-inbox");
/** The routines, their runs, and the pull request heads their sessions took, beside {@link tokenFile}. */
export const routinesFile = join(configDir, "routines.json");
/** The messages and session starts that wait for their time, beside {@link tokenFile}. */
export const scheduledFile = join(configDir, "scheduled.json");
/** The directories Settings → Workspaces added and hid, beside {@link tokenFile}. */
export const workspacesFile = join(configDir, "workspaces.json");
/**
 * The projects, their workers, and the updates waiting for their coordinators, beside {@link tokenFile}; omp's `projects` extension reads it.
 * An older version kept the {@link workspacesFile} list under this name, which the server moves away before it reads the projects.
 */
export const projectsFile = join(configDir, "projects.json");
/** Project `id`'s notes, which every session of the project reads and writes; outside every repository, so all worktrees share them. */
export const projectNotesDir = (id: string): string => join(dataDir, "projects", id);
/** The user's notes, which every project's sessions read: how the user works, and the workflows that held across projects. */
export const userNotesDir = join(dataDir, "user");
/** The sessions the sidebar pins, beside {@link tokenFile}. */
export const pinsFile = join(configDir, "pins.json");
/** The Google calendars the Calendar page's sidebar unchecked, beside {@link tokenFile}. */
export const calendarsFile = join(configDir, "calendars.json");
/** The address each Google account signs in as and the workspaces each address is linked to, beside {@link tokenFile}. */
export const googleAccountsFile = join(configDir, "google-accounts.json");
/** The events the Calendar page keeps on this computer, beside {@link tokenFile}. */
export const localEventsFile = join(configDir, "events.json");
/** The notices the bell's user saw or cleared, beside {@link tokenFile}. */
export const noticesFile = join(configDir, "notices.json");
/** The source control settings: automatic pulls of the workspaces' default branches, and the cleanup after a merge, beside {@link tokenFile}. */
export const sourceControlFile = join(configDir, "source-control.json");
/** The merges that wait until GitHub allows them, beside {@link tokenFile}. */
export const mergesFile = join(configDir, "merges.json");
/** The review drafts that Review sessions wrote for the user to post, and which session reviews which pull request, beside {@link tokenFile}. */
export const reviewDraftsFile = join(configDir, "review-drafts.json");
/** Settings sync's remote, branch, left-out items, and last outcome, beside {@link tokenFile}. */
export const settingsSyncFile = join(configDir, "settings-sync.json");
/** The bare Git repository settings sync fetches into and commits from, in the dashboard's data directory. */
export const settingsSyncRepo = join(dataDir, "settings-sync.git");
/** The Google calendars' secret addresses an older version kept, beside {@link tokenFile}; the server deletes it at startup. */
export const oldGoogleFile = join(configDir, "google.json");
/** Names the server that runs routines and applies the todo inbox, which servers side by side share, beside {@link tokenFile}. */
export const serverLockFile = join(configDir, "server.lock");

/** `path` with a leading `~` or `~/` read as the home directory; any other path unchanged. */
export const expandHome = (path: string): string => (path === "~" || path.startsWith("~/") ? join(HOME, path.slice(1)) : path);

/** `path` with the home directory shortened to `~`. */
export const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;

/** The directory `input` names (absolute, `~`-relative, or relative to the home directory), or `null` when it is not one; stats without blocking the event loop. */
export async function directoryOf(input: string): Promise<string | null> {
	const cwd = resolve(HOME, expandHome(input.trim()));
	const found = await stat(cwd).catch(() => null);
	return found?.isDirectory() ? cwd : null;
}
