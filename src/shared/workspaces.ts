/** The directories Settings → Workspaces adds to the ones sessions ran in, and the ones it hides. */

/** Absolute directories, or the page's rows for them; one in both lists is hidden, and showing it offers it again as added. */
export interface WorkspaceList<Entry = string> {
	/** Offered as workspaces, even before a session runs there. */
	added: Entry[];
	/** Left out of the pickers and the sidebar, with their sessions. */
	hidden: Entry[];
}

export interface WorkspaceChange {
	op: "add" | "hide" | "show";
	cwd: string;
}

/** A directory as the page shows it, `~` for the home directory. */
export interface Workspace {
	cwd: string;
	cwdDisplay: string;
}

export const NO_WORKSPACES: WorkspaceList = { added: [], hidden: [] };

/** `list` after `change`, or `list` itself when it changes nothing. Adding also shows a hidden directory. */
export function applyWorkspace(list: WorkspaceList, { op, cwd }: WorkspaceChange): WorkspaceList {
	const added = op === "add" && !list.added.includes(cwd) ? [...list.added, cwd] : list.added;
	const hidden =
		op === "hide" ? (list.hidden.includes(cwd) ? list.hidden : [...list.hidden, cwd])
		: list.hidden.filter(entry => entry !== cwd);
	// Each list only gains or loses `cwd`, so equal lengths mean nothing changed.
	return added.length === list.added.length && hidden.length === list.hidden.length ? list : { added, hidden };
}
