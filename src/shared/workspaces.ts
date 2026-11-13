/** The directories Settings → Workspaces adds to the ones sessions ran in, and the ones it hides. */

/** Absolute directories, or the page's rows for them; one in both lists is hidden, and showing it offers it again as added. */
export interface WorkspaceList<Entry = string> {
	/** Offered as workspaces, even before a session runs there. */
	added: Entry[];
	/** Left out of the pickers and the sidebar, with their sessions. */
	hidden: Entry[];
}

export type WorkspaceChange = { op: "add" | "hide" | "show"; cwd: string };

/** A directory as the page shows it, `~` for the home directory. */
export interface Workspace {
	cwd: string;
	cwdDisplay: string;
}

export const NO_WORKSPACES: WorkspaceList = { added: [], hidden: [] };

// `/var/folders` holds macOS's per-user `$TMPDIR`, where `mktemp -d` puts its directories.
const TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

/** Whether `dir` is a temp root or under one: no picker, list, or project list offers it. */
export const inTempDir = (dir: string): boolean => TEMP_ROOTS.some(root => dir === root || dir.startsWith(`${root}/`));

/** Whether `dir` is in an app's own data, a dot folder or a `Library` folder such as `~/.cache` or `~/Library`: no session there lists it as a workspace. */
export const inAppData = (dir: string): boolean => dir.split("/").some(part => part.startsWith(".") || part === "Library");

/** `entries` with `entry` once, the same array when it already holds it. */
const withEntry = (entries: string[], entry: string): string[] => (entries.includes(entry) ? entries : [...entries, entry]);
const withoutEntry = (entries: string[], entry: string): string[] => entries.filter(other => other !== entry);

/** `list` after `change`, or `list` itself when it changes nothing. Adding also shows a hidden directory. */
export function applyWorkspace(list: WorkspaceList, change: WorkspaceChange): WorkspaceList {
	const { cwd } = change;
	let next: WorkspaceList;
	switch (change.op) {
		case "add":
			next = { added: withEntry(list.added, cwd), hidden: withoutEntry(list.hidden, cwd) };
			break;
		case "hide":
			next = { ...list, hidden: withEntry(list.hidden, cwd) };
			break;
		case "show":
			next = { ...list, hidden: withoutEntry(list.hidden, cwd) };
			break;
		default: {
			const unhandled: never = change.op;
			return unhandled;
		}
	}
	// Each list only gains or loses `cwd`, so equal lengths mean nothing changed.
	return next.added.length === list.added.length && next.hidden.length === list.hidden.length ? list : next;
}
