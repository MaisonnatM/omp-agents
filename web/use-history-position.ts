import { useSyncExternalStore } from "react";

/** Whether the page has a Navigation API to follow; without one, Back and Forward stay available, since `history` cannot say where it stands. */
const hasNavigation = typeof navigation !== "undefined";

function subscribe(onChange: () => void) {
	if (!hasNavigation) return () => {};
	navigation.addEventListener("currententrychange", onChange);
	return () => navigation.removeEventListener("currententrychange", onChange);
}

/** Whether history can go back and forward now, following the Navigation API that Electron's Chromium and Chrome provide. */
export function useHistoryPosition(): { canGoBack: boolean; canGoForward: boolean } {
	const canGoBack = useSyncExternalStore(subscribe, () => !hasNavigation || navigation.canGoBack);
	const canGoForward = useSyncExternalStore(subscribe, () => !hasNavigation || navigation.canGoForward);
	return { canGoBack, canGoForward };
}
