/** The window's preload: hands the page `window.ompDesktop`, which reports the sessions that need you to `attention.ts` and whether the page takes Cmd+W. */
import { contextBridge, ipcRenderer } from "electron";
import { ALERT_CHANNEL, BADGE_CHANNEL, DESKTOP_BRIDGE, type DesktopBridge, OWNS_CLOSE_CHANNEL } from "../src/shared/desktop-bridge";

const bridge: DesktopBridge = {
	badge: count => ipcRenderer.send(BADGE_CHANNEL, count),
	alert: alert => ipcRenderer.send(ALERT_CHANNEL, alert),
	ownsClose: owns => ipcRenderer.send(OWNS_CLOSE_CHANNEL, owns),
};
contextBridge.exposeInMainWorld(DESKTOP_BRIDGE, bridge);
