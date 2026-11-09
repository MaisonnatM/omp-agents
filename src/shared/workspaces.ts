/** The directories Settings → Workspaces adds to the ones sessions ran in, the ones it hides, and the ones it places in the Personal space. */
import { oneOf } from "../json";

/** The two halves of the dashboard, in the order the page lists them: the user's own life, and their job. */
export const SPACES = ["personal", "work"] as const;
export type Space = (typeof SPACES)[number];

export const isSpace = oneOf(SPACES);

export const otherSpace = (space: Space): Space => (space === "personal" ? "work" : "personal");

/** Absolute directories, or the page's rows for them; one in both lists is hidden, and showing it offers it again as added. */
export interface WorkspaceList<Entry = string> {
	/** Offered as workspaces, even before a session runs there. */
	added: Entry[];
	/** Left out of the pickers and the sidebar, with their sessions. */
	hidden: Entry[];
	/** Main checkouts placed in the Personal space; every other workspace is Work, but the personal directory, which is always Personal and never listed. */
	personal: Entry[];
}

export type WorkspaceChange = { op: "add" | "hide" | "show"; cwd: string } | { op: "space"; cwd: string; space: Space };

/** A directory as the page shows it, `~` for the home directory. */
export interface Workspace {
	cwd: string;
	cwdDisplay: string;
}

export const NO_WORKSPACES: WorkspaceList = { added: [], hidden: [], personal: [] };

// `/var/folders` holds macOS's per-user `$TMPDIR`, where `mktemp -d` puts its directories.
const TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

/** Whether `dir` is a temp root or under one: no picker, list, or project list offers it. */
export const inTempDir = (dir: string): boolean => TEMP_ROOTS.some(root => dir === root || dir.startsWith(`${root}/`));

/** `entries` with `entry` once, the same array when it already holds it. */
const withEntry = (entries: string[], entry: string): string[] => (entries.includes(entry) ? entries : [...entries, entry]);
const withoutEntry = (entries: string[], entry: string): string[] => entries.filter(other => other !== entry);

/**
 * `list` after `change`, or `list` itself when it changes nothing. Adding also shows a hidden directory. Hiding or showing a
 * workspace keeps its space, so a Personal workspace hidden and shown again is still Personal.
 */
export function applyWorkspace(list: WorkspaceList, change: WorkspaceChange): WorkspaceList {
	const { cwd } = change;
	let next: WorkspaceList;
	switch (change.op) {
		case "add":
			next = { ...list, added: withEntry(list.added, cwd), hidden: withoutEntry(list.hidden, cwd) };
			break;
		case "hide":
			next = { ...list, hidden: withEntry(list.hidden, cwd) };
			break;
		case "show":
			next = { ...list, hidden: withoutEntry(list.hidden, cwd) };
			break;
		case "space":
			next = { ...list, personal: change.space === "personal" ? withEntry(list.personal, cwd) : withoutEntry(list.personal, cwd) };
			break;
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
	// Each list only gains or loses `cwd`, so equal lengths mean nothing changed.
	return next.added.length === list.added.length && next.hidden.length === list.hidden.length && next.personal.length === list.personal.length ? list : next;
}

/** Which space each directory is in, from the `personal` list and the personal directory, the one rule the server, the personal extension, and the page share. */
export interface Spaces {
	/**
	 * Whether `cwd` is the personal directory itself, named as omp names it or as the page shows it, `~` included, with any
	 * trailing `/`. It is always Personal, so the server refuses to move it to Work and Settings › Workspaces offers no picker for it.
	 */
	isPersonalDir(cwd: string): boolean;
	/**
	 * The space of a session in `cwd` that counts in `workspace`, the main checkout of a linked worktree as `WorkspacePlacement`
	 * places it, else `cwd` itself: Personal in the personal directory or in a workspace `personal` lists, else Work.
	 */
	of(cwd: string, workspace: string): Space;
	/** The workspaces of `workspaces` in `space`, each a directory or a row for one. */
	inSpace<W extends string | Workspace>(workspaces: readonly W[], space: Space): W[];
}

/**
 * The {@link Spaces} of the workspaces `personal` lists and `personalDir`, whose `cwdDisplay` is how a `~` path names it. Until the page
 * hears the personal directory, `personalDir` is `null` and only the listed workspaces are Personal.
 */
export function spaces(personal: readonly string[], personalDir: Workspace | null): Spaces {
	const isPersonalDir = (cwd: string): boolean => {
		if (!personalDir) return false;
		// The root keeps its `/`.
		const dir = cwd.trim().replace(/(?<=.)\/+$/, "");
		return dir === personalDir.cwd || dir === personalDir.cwdDisplay;
	};
	const of = (cwd: string, workspace: string): Space => (isPersonalDir(cwd) || personal.includes(workspace) ? "personal" : "work");
	return {
		isPersonalDir,
		of,
		inSpace: (workspaces, space) =>
			workspaces.filter(workspace => {
				const cwd = typeof workspace === "string" ? workspace : workspace.cwd;
				return of(cwd, cwd) === space;
			}),
	};
}
