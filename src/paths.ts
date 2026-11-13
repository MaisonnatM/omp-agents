import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { portFromEnv } from "./server/address";
import type { Workspace } from "./shared/workspaces";

export const HOME = homedir();

const configDir = join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "omp-agents");
/** Files the dashboard keeps that the file dialog may open, unlike {@link configDir}: `$XDG_DATA_HOME/omp-agents`, else `~/.local/share/omp-agents`. */
const dataDir = join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "omp-agents");

/** Where the dashboard keeps its access token: `$XDG_CONFIG_HOME/omp-agents/token`, else `~/.config/omp-agents/token`. */
export const tokenFile = join(configDir, "token");

/**
 * Phone access: whether it is on, the tailnet address it serves, and the paired phones' token hashes, beside {@link tokenFile}.
 * Mode 0600, since it names every phone that can reach the dashboard.
 */
export const phoneAccessFile = join(configDir, "phone-access.json");

/** The sessions this dashboard started that stopped without End session, beside {@link tokenFile}. */
export const interruptedFile = join(configDir, "interrupted.json");
/** Active explicit task owners shared by every dashboard port, beside {@link tokenFile}. */
export const taskClaimsFile = join(configDir, "task-claims.json");
/**
 * Where the keepers of the sessions the server on `PORT` started listen, a Unix socket and a log each, beside {@link tokenFile}.
 * One directory per port, so a server on another port, such as a smoke run, never takes over this one's sessions.
 */
export const keepersDir = join(configDir, "sessions", String(portFromEnv()));
/** The turns this port's server's sessions ended that no page read yet: one file per port, as {@link keepersDir}, since instance ids are each server's own. */
export const unreadFile = join(configDir, "unread", `${portFromEnv()}.json`);

/** The Todo page's list, beside {@link tokenFile}. */
export const userTodosFile = join(configDir, "todos.json");

/**
 * Where omp's `user_todo` tool leaves its changes to the Todo page's list, one JSON file each, beside {@link tokenFile}.
 * The server applies and deletes them, so it stays the only writer of {@link userTodosFile}.
 */
export const userTodoInboxDir = join(configDir, "todo-inbox");
/** The Sport module's plan, measurements, and workout log, beside {@link tokenFile}. */
export const sportFile = join(configDir, "sport.json");
/** Where omp's `sport` tool leaves its changes to the Sport module, one JSON file each, so the server stays the only writer of {@link sportFile}. */
export const sportInboxDir = join(configDir, "sport-inbox");
/** The demo thumbnails YouTube served once, `<video id>.jpg` each, in the dashboard's data directory. */
export const sportThumbsDir = join(dataDir, "sport-thumbs");
/** Where omp's `user_event` tool leaves the reminders it adds and removes, one JSON file each, so the server stays the only writer of {@link localEventsFile}. */
export const eventInboxDir = join(configDir, "event-inbox");
/** Where omp's `end_session` tool asks the server to end a session, one `<session id>.json` each, beside {@link tokenFile}. */
export const sessionEndInboxDir = join(configDir, "end-inbox");
/** Where the starter kit's `google-accounts` extension reports a Gmail or Google Calendar account that answered a session with HTTP 401, one JSON file each. */
export const signInInboxDir = join(configDir, "sign-in-inbox");
/** The routines, their runs, and the pull request heads their sessions took, beside {@link tokenFile}. */
export const routinesFile = join(configDir, "routines.json");
/** Where a Bot's `save_routine` and `delete_routine` tools leave their changes to its routines, one JSON file each, so the server stays the only writer of {@link routinesFile}. */
export const routineInboxDir = join(configDir, "routine-inbox");
/** The id Settings sync gives this computer, so a routine another computer runs names it apart from this one, beside {@link tokenFile}. */
export const machineFile = join(configDir, "machine.json");
/** The Bots: each one's name, job, workspace, and conversation, beside {@link tokenFile}. */
export const botsFile = join(configDir, "bots.json");
/** Where a Bot's `set_job` tool leaves the job it gives itself, one JSON file each, so the server stays the only writer of {@link botsFile}. */
export const botInboxDir = join(configDir, "bot-inbox");
/** Where a PR shepherd Bot's `fix_pull_request` and `queue_merge` tools leave their requests, one JSON file each. */
export const shepherdInboxDir = join(configDir, "shepherd-inbox");
/** Each Bot's `<id>/memory.md`, which its own session writes, in the dashboard's data directory. */
export const botsDir = join(dataDir, "bots");
/**
 * Where this port's private sessions keep everything omp writes for them, one `<instance id>` directory each, as {@link keepersDir} is per port.
 * A directory's presence is the only record that its session is private; deleting it, last, is what deletes the session.
 */
export const privateSessionsDir = join(dataDir, "private-sessions", String(portFromEnv()));
/** The messages and session starts that wait for their time, beside {@link tokenFile}. */
export const scheduledFile = join(configDir, "scheduled.json");
/** The directories Settings → Workspaces added and hid, beside {@link tokenFile}. */
export const workspacesFile = join(configDir, "workspaces.json");
/** Where an older version kept the {@link workspacesFile} list, beside {@link tokenFile}; the server moves it at startup. */
export const oldWorkspacesFile = join(configDir, "projects.json");
/** The project code the user trusted, by project, with the hash of each piece as it was trusted, beside {@link tokenFile}. */
export const projectTrustFile = join(configDir, "project-trust.json");
/** The sessions the sidebar pins, beside {@link tokenFile}. */
export const pinsFile = join(configDir, "pins.json");
/** The page's preferences that follow the user to every machine, beside {@link tokenFile}. */
export const preferencesFile = join(configDir, "preferences.json");
/** When the idle stop ends a session's processes, beside {@link tokenFile}. */
export const processesFile = join(configDir, "processes.json");
/** The model profiles Settings › Models saved, beside {@link tokenFile}; omp's own `config.yml` never holds them. */
export const modelProfilesFile = join(configDir, "model-profiles.json");
/** The fallback lists the composer's Extra usage switch parked, beside {@link tokenFile}. */
export const extraUsageFile = join(configDir, "extra-usage.json");
/** The Google calendars the Calendar page's sidebar unchecked, beside {@link tokenFile}. */
export const calendarsFile = join(configDir, "calendars.json");
/** The address each Google account signs in as and when a session found each signed out, beside {@link tokenFile}. */
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
/** The page's activity events, which Settings › Activity reports, in the dashboard's data directory; a machine file settings sync never carries. */
export const activityDb = join(dataDir, "activity.db");
/** The Google calendars' secret addresses an older version kept, beside {@link tokenFile}; the server deletes it at startup. */
export const oldGoogleFile = join(configDir, "google.json");
/** Names the server that runs routines and applies the todo inbox, which servers side by side share, beside {@link tokenFile}. */
export const serverLockFile = join(configDir, "server.lock");

/** `path` with a leading `~` or `~/` read as the home directory; any other path unchanged. */
export const expandHome = (path: string): string => (path === "~" || path.startsWith("~/") ? join(HOME, path.slice(1)) : path);

/** `path` with the home directory shortened to `~`. */
export const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;

/** Directory `cwd` as the page shows a workspace, with its {@link displayPath}. */
export const workspaceFor = (cwd: string): Workspace => ({ cwd, cwdDisplay: displayPath(cwd) });

/** The absolute path `input` names (absolute, `~`-relative, or relative to the home directory), without checking that it exists. */
export const absoluteDir = (input: string): string => resolve(HOME, expandHome(input.trim()));

/** {@link directoryOf} after creating the directory `input` names, with any parent it lacks; `null` when it cannot be one. */
export async function createdDirectoryOf(input: string): Promise<string | null> {
	await mkdir(absoluteDir(input), { recursive: true }).catch(() => undefined);
	return directoryOf(input);
}

/** The directory `input` names, as {@link absoluteDir} reads it, or `null` when it is not one; stats without blocking the event loop. */
export async function directoryOf(input: string): Promise<string | null> {
	const cwd = absoluteDir(input);
	const found = await stat(cwd).catch(() => null);
	return found?.isDirectory() ? cwd : null;
}
