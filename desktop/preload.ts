/**
 * The window's preload: signs the dashboard's page in before its scripts run, then hands it `window.ompDesktop`, which
 * reports the sessions that need you to `attention.ts` and asks for a sign-in.
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { isString, recordOf } from "../src/json";
import { ACCESS_CHANNEL, ALERT_CHANNEL, BADGE_CHANNEL, DESKTOP_BRIDGE, type DesktopBridge, SIGN_IN_CHANNEL, TARGET_URL_CHANNEL } from "../src/shared/desktop-bridge";

// Main answers only the dashboard's own page, so any other page, such as the shell's own notice, gets nothing.
const access: unknown = ipcRenderer.sendSync(ACCESS_CHANNEL);
if (recordOf(isString)(access)) for (const [key, value] of Object.entries(access)) localStorage.setItem(key, value);

const bridge: DesktopBridge = {
	badge: count => ipcRenderer.send(BADGE_CHANNEL, count),
	alert: alert => ipcRenderer.send(ALERT_CHANNEL, alert),
	onTargetURL: listener => {
		const receive = (_event: IpcRendererEvent, url: unknown): void => {
			if (typeof url === "string") listener(url);
		};
		ipcRenderer.on(TARGET_URL_CHANNEL, receive);
		return () => { ipcRenderer.removeListener(TARGET_URL_CHANNEL, receive); };
	},
	signIn: () => ipcRenderer.send(SIGN_IN_CHANNEL),
	titleBar: process.platform === "darwin",
};
contextBridge.exposeInMainWorld(DESKTOP_BRIDGE, bridge);
