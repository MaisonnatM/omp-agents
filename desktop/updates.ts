/**
 * Updates of the packaged app from the repository's GitHub Releases, through electron-updater, as T3 Code does: a
 * first check shortly after launch, then a poll, a download in the background, and the install when the app quits.
 * Nothing restarts on its own, since quitting stops every session the dashboard started.
 */
import { dialog, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { errorText } from "../src/json";

/** Lets the window and the server start before the first check competes with them. */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

export interface Updates {
	/** The version downloaded and waiting for a quit, or `null`. */
	ready(): string | null;
	/** Checks now and answers in a dialog, even when there is nothing new. */
	checkNow(): void;
	/** Quits and opens the new version. Call it once the server has stopped. */
	install(): void;
}

/** Starts checking; `changed` runs when a version finishes downloading, so the menu can offer it. */
export function startUpdates(changed: () => void): Updates {
	let ready: string | null = null;
	let asked = false;
	autoUpdater.autoInstallOnAppQuit = true;
	// The download that follows ends in a notification, so a manual check needs no dialog of its own.
	autoUpdater.on("update-available", () => {
		asked = false;
	});
	autoUpdater.on("update-downloaded", info => {
		ready = info.version;
		changed();
		new Notification({ title: `omp agents ${info.version} is ready`, body: "It installs when you quit, or now from the app menu." }).show();
	});
	autoUpdater.on("update-not-available", info => {
		if (!asked) return;
		asked = false;
		void dialog.showMessageBox({ message: "omp agents is up to date", detail: `Version ${info.version} is the newest.` });
	});
	autoUpdater.on("error", err => {
		console.error(`omp-agents: update check failed: ${errorText(err)}`);
		if (!asked) return;
		asked = false;
		dialog.showErrorBox("Update check failed", errorText(err));
	});
	const check = (): void => void autoUpdater.checkForUpdates().catch(() => {});
	setTimeout(check, FIRST_CHECK_DELAY_MS).unref();
	setInterval(check, CHECK_EVERY_MS).unref();
	return {
		ready: () => ready,
		checkNow() {
			asked = true;
			check();
		},
		// Silent, and relaunched once installed, as T3 Code installs.
		install: () => autoUpdater.quitAndInstall(true, true),
	};
}
