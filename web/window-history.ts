/** Back and Forward, which move through the window's history. */
import { useSyncExternalStore } from "react";

/** Shows the entry one step `by` through the window's history. */
export function goInHistory(by: -1 | 1): void {
	history.go(by);
}

/** The mouse's back and forward buttons, by `MouseEvent.button`. */
const MOUSE_STEP: Partial<Record<number, -1 | 1>> = { 3: -1, 4: 1 };

/** Takes the mouse's back and forward buttons, which the desktop app's window ignores, until the returned function stops it. */
export function followMouseHistoryButtons(): () => void {
	const onMouseUp = (event: MouseEvent): void => {
		const by = MOUSE_STEP[event.button];
		if (by === undefined) return;
		event.preventDefault();
		goInHistory(by);
	};
	window.addEventListener("mouseup", onMouseUp);
	return () => window.removeEventListener("mouseup", onMouseUp);
}

const subscribe = (onChange: () => void): (() => void) => {
	if (typeof navigation === "undefined") return () => {};
	navigation.addEventListener("currententrychange", onChange);
	return () => navigation.removeEventListener("currententrychange", onChange);
};

/** Whether the window can go back and forward now; both `true` without the Navigation API, which cannot tell. */
export function useWindowHistory(): { canGoBack: boolean; canGoForward: boolean } {
	const canGoBack = useSyncExternalStore(subscribe, () => (typeof navigation === "undefined" ? true : navigation.canGoBack));
	const canGoForward = useSyncExternalStore(subscribe, () => (typeof navigation === "undefined" ? true : navigation.canGoForward));
	return { canGoBack, canGoForward };
}
