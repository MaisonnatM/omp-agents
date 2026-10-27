/**
 * The sessions that need you, outside the window: the Dock badge counts them, and each moment one asks or ends a turn
 * shows a system notification while the window is not focused, whose click brings the window up on that session, and
 * plays the sound the page chose, also on its own while the window is focused. The page counts and raises them
 * (`web/use-attention.ts`) and reports them through `preload.ts`.
 */
import { execFile } from "node:child_process";
import { app, type BrowserWindow, ipcMain, type IpcMainEvent, Notification, shell } from "electron";
import { ALERT_CHANNEL, BADGE_CHANNEL, isNotificationSound, isSessionAlert, type NotificationSound, SOUND_CHANNEL } from "../src/shared/desktop-bridge";

/** The name macOS looks `sound` up by among its system sounds; none for `off` and for `default`, the system's own. */
const systemName = (sound: NotificationSound): string | undefined => (sound === "off" || sound === "default" ? undefined : sound);

/** Plays `sound` outside a notification: a named sound through `afplay` on macOS, else the system's beep. */
function play(sound: NotificationSound): void {
	if (sound === "off") return;
	const name = systemName(sound);
	if (name && process.platform === "darwin") execFile("afplay", [`/System/Library/Sounds/${name}.aiff`], () => {});
	else shell.beep();
}

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
		shown.get(alert.hash)?.close();
		const sound = alert.sound ?? "default";
		const notification = new Notification({ title: alert.title, body: alert.body, silent: sound === "off", sound: systemName(sound) });
		notification.on("click", () => {
			reveal();
			void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(alert.hash)}`).catch(() => {});
		});
		notification.on("close", () => {
			if (shown.get(alert.hash) === notification) shown.delete(alert.hash);
		});
		shown.set(alert.hash, notification);
		notification.show();
	});
	ipcMain.on(SOUND_CHANNEL, (event, sound: unknown) => {
		if (trusted(event) && isNotificationSound(sound)) play(sound);
	});
}
