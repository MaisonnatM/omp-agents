/** `usePhoneWidth`: whether the window is a phone's width, the line the floating sidebars and the `max-phone:` classes draw. */
import { useSyncExternalStore } from "react";
import { PHONE_MAX_WIDTH } from "./components/sidebar-panel";

const PHONE_WIDTH = `(width < ${PHONE_MAX_WIDTH}px)`;

const subscribe = (onChange: () => void): (() => void) => {
	const query = window.matchMedia(PHONE_WIDTH);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
};

/** Whether the window is narrower than {@link PHONE_MAX_WIDTH}, renewed as it crosses that width. */
export const usePhoneWidth = (): boolean => useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_WIDTH).matches);
