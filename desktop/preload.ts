/** The window's preload: hands the page `window.ompDesktop`, which reports the sessions that need you to `attention.ts` and asks for a sign-in. */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { ALERT_CHANNEL, BADGE_CHANNEL, DESKTOP_BRIDGE, type DesktopBridge, SIGN_IN_CHANNEL, TARGET_URL_CHANNEL } from "../src/shared/desktop-bridge";

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
};
contextBridge.exposeInMainWorld(DESKTOP_BRIDGE, bridge);
