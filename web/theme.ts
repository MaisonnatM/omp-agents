import { useSyncExternalStore } from "react";
import { onStoredChange, useStoredState } from "./stored-state";

/** The page's color scheme: follow the OS, or pin light or dark. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

const THEME_KEY = "omp-agents.theme";

const OS_DARK = "(prefers-color-scheme: dark)";

const themeOf = (stored: string | null): Theme => THEMES.find(theme => theme === stored) ?? "system";

// The Fluid tokens switch on a `.dark` class.
function applyStoredTheme(): void {
	const theme = themeOf(localStorage.getItem(THEME_KEY));
	document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && window.matchMedia(OS_DARK).matches));
}

/** Applies the saved theme before the first render, again whenever it changes, from this page, another, or the server, and follows the OS while it is `system`. */
export function startTheme(): void {
	applyStoredTheme();
	onStoredChange(THEME_KEY, applyStoredTheme);
	window.matchMedia(OS_DARK).addEventListener("change", applyStoredTheme);
}

/** The saved theme and its setter, which keeps it in localStorage; {@link startTheme} applies it. */
export const useTheme = (): [Theme, (theme: Theme) => void] => useStoredState(THEME_KEY, themeOf);

function onClassChange(changed: () => void): () => void {
	const observer = new MutationObserver(changed);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
	return () => observer.disconnect();
}

/** Whether the page shows dark now, read from the `.dark` class the tokens switch on, so it also follows the OS under `system`. */
export function useDarkClass(): boolean {
	return useSyncExternalStore(onClassChange, () => document.documentElement.classList.contains("dark"));
}
