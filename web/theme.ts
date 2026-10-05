import { useStoredState } from "./stored-state";

/** The page's color scheme: follow the OS, or pin light or dark. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

const THEME_KEY = "omp-agents.theme";

const OS_DARK = "(prefers-color-scheme: dark)";

const themeOf = (stored: string | null): Theme => THEMES.find(theme => theme === stored) ?? "system";

const storedTheme = (): Theme => themeOf(localStorage.getItem(THEME_KEY));

// The Fluid tokens switch on a `.dark` class.
const applyTheme = (theme: Theme): void =>
	void document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && window.matchMedia(OS_DARK).matches));

/** Applies the saved theme before the first render, and follows the OS while the theme is `system`. */
export function startTheme(): void {
	applyTheme(storedTheme());
	window.matchMedia(OS_DARK).addEventListener("change", () => applyTheme(storedTheme()));
}

/** The saved theme and its setter, which applies it at once and keeps it in localStorage. */
export function useTheme(): [Theme, (theme: Theme) => void] {
	const [theme, store] = useStoredState(THEME_KEY, themeOf);
	const pick = (next: Theme): void => {
		store(next);
		applyTheme(next);
	};
	return [theme, pick];
}
