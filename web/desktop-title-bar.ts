/** Whether the window has no system title bar: the desktop app on macOS hides it, so the window's buttons sit over the header tabs' row, which drags the window. */
export const DESKTOP_TITLE_BAR = typeof window !== "undefined" && window.ompDesktop?.titleBar === true;
