/** One terminal tab and its lifecycle: how its shell moves from starting through closing to gone. */
import type { TerminalInfo } from "../../../src/shared/terminals";

/**
 * Where a tab's shell is. `starting`: the server has yet to open the new shell. `connected`: the server opened or
 * listed it. `closing`: the tab asked the shell to exit and waits for its socket to close. `disconnected`: the server
 * hung up without the shell exiting, so only removing the tab is left.
 */
export type TerminalTabState =
	| { phase: "starting" }
	| { phase: "connected"; terminal: TerminalInfo }
	| { phase: "closing"; terminal: TerminalInfo | null }
	| { phase: "disconnected"; terminal: TerminalInfo | null };

export interface Tab {
	key: string;
	target: { id: string } | { cwd: string };
	state: TerminalTabState;
}

/** What happens to a tab: its socket reports the shell, the user closes the tab, or its socket closes, after the shell exited or not. */
export type TabEvent = { t: "opened"; terminal: TerminalInfo } | { t: "close" } | { t: "closed"; exited: boolean };

export const newTab = (cwd: string): Tab => ({ key: crypto.randomUUID(), target: { cwd }, state: { phase: "starting" } });

export const restoredTab = (terminal: TerminalInfo): Tab => ({ key: terminal.id, target: { id: terminal.id }, state: { phase: "connected", terminal } });

/** The tab's shell, once the server opened or listed it. */
export const tabTerminal = (state: TerminalTabState): TerminalInfo | null => (state.phase === "starting" ? null : state.terminal);

/**
 * Whether closing a tab in `state` must ask its shell to exit. A starting tab's shell may already run, so its close goes
 * through the socket, which retains the request until it connects, like a connected tab's.
 */
export const closeEndsShell = (state: TerminalTabState): boolean => state.phase === "starting" || state.phase === "connected";

/** The tab's state after `event`, or `null` once the tab is gone: its shell exited, or its socket closed after it asked or lost the shell. */
export function nextTabState(state: TerminalTabState, event: TabEvent): TerminalTabState | null {
	switch (event.t) {
		case "opened":
			if (state.phase === "starting") return { phase: "connected", terminal: event.terminal };
			if (state.phase === "closing") return { phase: "closing", terminal: event.terminal };
			return state;
		case "close":
			if (closeEndsShell(state)) return { phase: "closing", terminal: tabTerminal(state) };
			return state.phase === "disconnected" ? null : state;
		case "closed":
			if (event.exited || state.phase === "closing") return null;
			return { phase: "disconnected", terminal: tabTerminal(state) };
	}
}
