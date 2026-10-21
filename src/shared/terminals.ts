/** A shell the dashboard's terminal panel runs, as `GET /api/terminals` lists it, oldest first. */
export interface TerminalInfo {
	id: string;
	/** The directory the shell started in. */
	cwd: string;
	/** `cwd` with the home directory shortened to `~`, as the tab names it. */
	cwdDisplay: string;
}

/**
 * A text frame on `/ws/terminal`, from the server: the terminal the socket shows once it opened or attached, then its
 * exit. The shell's output travels as binary frames between them.
 */
export type TerminalServerMsg = { t: "opened"; terminal: TerminalInfo } | { t: "exit"; code: number | null };

/** A text frame on `/ws/terminal`, from the page. What you type travels as binary frames. */
export type TerminalClientMsg = { t: "resize"; cols: number; rows: number } | { t: "kill" };

/** The address a terminal socket attaches to `id`'s shell at, or opens a new shell in `cwd` at, sized `cols` by `rows`. */
export const terminalSocketPath = (target: { id: string } | { cwd: string; cols: number; rows: number }): string =>
	`/ws/terminal?${new URLSearchParams("id" in target ? { id: target.id } : { cwd: target.cwd, cols: String(target.cols), rows: String(target.rows) })}`;
