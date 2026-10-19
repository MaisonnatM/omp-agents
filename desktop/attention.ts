/**
 * The sessions that need you, outside the window: the Dock badge counts them, and each moment one asks or ends a turn
 * shows a system notification, whose click brings the window up on that session. The page decides both
 * (`web/use-attention.ts`) and reports them through `preload.ts`.
 */
import { app, type BrowserWindow, ipcMain, type IpcMainEvent, Notification } from "electron";
import { ALERT_CHANNEL, BADGE_CHANNEL, isSessionAlert } from "../src/shared/desktop-bridge";
import { hashForSession } from "../src/shared/sessions";

/** Takes the page's reports; `fromDashboard` tells the dashboard's own page from a page of the shell's, and `reveal` shows and focuses the window. */
export function showAttention(win: BrowserWindow, fromDashboard: (url: string) => boolean, reveal: () => void): void {
	const trusted = (event: IpcMainEvent): boolean => event.sender === win.webContents && fromDashboard(event.senderFrame?.url ?? "");
	// Electron forgets a notification it holds no reference to, and with it the click; a session's newer one replaces it.
	const shown = new Map<string, Notification>();
	ipcMain.on(BADGE_CHANNEL, (event, count: unknown) => {
		if (trusted(event) && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) app.setBadgeCount(count);
	});
	ipcMain.on(ALERT_CHANNEL, (event, alert: unknown) => {
		if (!trusted(event) || !isSessionAlert(alert) || win.isFocused()) return;
		shown.get(alert.sessionId)?.close();
		const notification = new Notification({ title: alert.title, body: alert.body });
		notification.on("click", () => {
			reveal();
			void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hashForSession(alert.sessionId))}`).catch(() => {});
		});
		notification.on("close", () => {
			if (shown.get(alert.sessionId) === notification) shown.delete(alert.sessionId);
		});
		shown.set(alert.sessionId, notification);
		notification.show();
	});
}
