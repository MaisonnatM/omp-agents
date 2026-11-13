/** The terminal panel's tabs and how they start: restored from the shells the server runs, then one new shell when it runs none or one was asked for. */
import type { TerminalInfo } from "../../../src/shared/terminals";
import { errorText } from "../../../src/json";
import { newTab, restoredTab, type Tab } from "./terminal-tab";

/** The panel's tabs: still reading the server's shells, that read failed with `error`, or the tabs it shows. */
export type TerminalTabs = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; tabs: Tab[] };

export const LOADING_TABS: TerminalTabs = { state: "loading" };

/**
 * The tabs for the shells `read` lists: one per running shell, then one new shell in `cwd()` when none runs or `extra()`
 * says one was asked for, such as by **New terminal**, once the read lands. A failed read is `failed`, never a new shell,
 * since shells the page cannot list may still run.
 */
export async function readTerminalTabs(read: () => Promise<TerminalInfo[]>, cwd: () => string, extra: () => boolean): Promise<TerminalTabs> {
	let running: TerminalInfo[];
	try {
		running = await read();
	} catch (err) {
		return { state: "failed", error: errorText(err) };
	}
	return { state: "ready", tabs: [...running.map(restoredTab), ...(running.length === 0 || extra() ? [newTab(cwd())] : [])] };
}
