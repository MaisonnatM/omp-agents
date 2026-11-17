/** Back and Forward, which move through the history of the header tab on screen, as a browser tab's do, rather than through the window's. */
import { decodeHeaderTabs, encodeHeaderTabs, HEADER_TABS_KEY, stepHeaderTab } from "./header-tabs";
import { updateStored, useStoredState } from "./stored-state";

/** The window's history entry the header tabs last saw, by its Navigation API key, which a push changes and a replace keeps. */
let seenEntry: string | null = null;

/**
 * Whether the window's history gained an entry since the last call, so the tab on screen takes the move as a push or a replace as the window's
 * history did; a push without the Navigation API, which Electron's Chromium has.
 */
export function windowPushed(): boolean {
	if (typeof navigation === "undefined") return true;
	const key = navigation.currentEntry?.key ?? null;
	const pushed = key !== seenEntry;
	seenEntry = key;
	return pushed;
}

/** Shows `hash` in place of the window's current history entry: the header tabs keep the history, so switching tabs or stepping through one adds no entry. */
export function showInPlace(hash: string): void {
	location.replace(hash || "#");
}

/** Shows the entry one step `by` through the tab on screen's history; `false` when its history ends there. */
export function goInHeaderTab(by: -1 | 1): boolean {
	const stepped: { go: string | null } = { go: null };
	updateStored(HEADER_TABS_KEY, decodeHeaderTabs, encodeHeaderTabs, row => {
		const step = stepHeaderTab(row, by);
		stepped.go = step?.go ?? null;
		return step?.row ?? row;
	});
	if (stepped.go === null) return false;
	showInPlace(stepped.go);
	return true;
}

/** The mouse's back and forward buttons, by `MouseEvent.button`. */
const MOUSE_STEP: Partial<Record<number, -1 | 1>> = { 3: -1, 4: 1 };

/** Takes the mouse's back and forward buttons for the tab on screen, until the returned function stops it. */
export function followMouseHistoryButtons(): () => void {
	const onMouseUp = (event: MouseEvent): void => {
		const by = MOUSE_STEP[event.button];
		if (by === undefined) return;
		event.preventDefault();
		goInHeaderTab(by);
	};
	window.addEventListener("mouseup", onMouseUp);
	return () => window.removeEventListener("mouseup", onMouseUp);
}

/** Whether the tab on screen can go back and forward now. */
export function useHeaderTabHistory(): { canGoBack: boolean; canGoForward: boolean } {
	const [row] = useStoredState(HEADER_TABS_KEY, decodeHeaderTabs, encodeHeaderTabs);
	const tab = row.tabs[row.active];
	return { canGoBack: (tab?.back.length ?? 0) > 0, canGoForward: (tab?.forward.length ?? 0) > 0 };
}
