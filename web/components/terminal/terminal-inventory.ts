/** The terminal panel's tabs and how they start: restored from the shells the server runs, or one new shell when it runs none. */
import type { TerminalInfo } from "../../../src/shared/terminals";
import { errorText } from "../../api";

export interface Tab {
	key: string;
	target: { id: string } | { cwd: string };
	/** The shell, once the server opened or found it. */
	terminal: TerminalInfo | null;
	/** The server hung up on the tab without its shell exiting, so only closing the tab is left. */
	lost: boolean;
	closing: boolean;
}

export const newTab = (cwd: string): Tab => ({ key: crypto.randomUUID(), target: { cwd }, terminal: null, lost: false, closing: false });

const restoredTab = (terminal: TerminalInfo): Tab => ({ key: terminal.id, target: { id: terminal.id }, terminal, lost: false, closing: false });

/** The panel's tabs: still reading the server's shells, that read failed with `error`, or the tabs it shows. */
export type TerminalTabs = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; tabs: Tab[] };

export const LOADING_TABS: TerminalTabs = { state: "loading" };

/**
 * The tabs for the shells `read` lists: one per running shell, or one new shell in `cwd()` when none runs. A failed read
 * is `failed`, never a new shell, since shells the page cannot list may still run.
 */
export async function readTerminalTabs(read: () => Promise<TerminalInfo[]>, cwd: () => string): Promise<TerminalTabs> {
	let running: TerminalInfo[];
	try {
		running = await read();
	} catch (err) {
		return { state: "failed", error: errorText(err) };
	}
	return { state: "ready", tabs: running.length ? running.map(restoredTab) : [newTab(cwd())] };
}
