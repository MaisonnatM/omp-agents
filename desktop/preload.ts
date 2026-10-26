/** The window's preload: hands the page `window.ompDesktop`, which reports the sessions that need you to `attention.ts`. */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { ALERT_CHANNEL, BADGE_CHANNEL, DESKTOP_BRIDGE, type DesktopBridge, TARGET_URL_CHANNEL } from "../src/shared/desktop-bridge";

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
};
contextBridge.exposeInMainWorld(DESKTOP_BRIDGE, bridge);
