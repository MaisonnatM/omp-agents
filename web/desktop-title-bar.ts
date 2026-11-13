/**
 * Marks the page when the window has no system title bar: the desktop app on macOS hides it, so the window's buttons sit
 * over the header tabs' row, which drags the window. `--title-bar-height` in `web/globals.css` reads the mark.
 */
export function startDesktopTitleBar(): void {
	if (window.ompDesktop?.titleBar === true) document.documentElement.dataset.titleBar = "";
}
