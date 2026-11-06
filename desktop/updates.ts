/**
 * Updates of the packaged app from the repository's GitHub Releases, through electron-updater, as T3 Code does: a
 * first check shortly after launch, then a poll, a download in the background, and the install when the app quits.
 * Nothing restarts on its own, since quitting stops every session the dashboard started.
 */
import { dialog, Notification } from "electron";
import { autoUpdater, type UpdateCheckResult } from "electron-updater";
import { errorText } from "../src/json";

/** Lets the window and the server start before the first check competes with them. */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

export interface Updates {
	/** The version downloaded and waiting for a quit, or `null`. */
	ready(): string | null;
	/** Checks now and answers in a dialog, even when there is nothing new. */
	checkNow(): void;
	/** Quits and opens the new version, or rejects with why it could not, since electron-updater reports a failed install only as an `error` event. Call it once the server has stopped. */
	install(): Promise<never>;
}

/** Starts checking; `changed` runs when a version finishes downloading, so the menu can offer it. */
export function startUpdates(changed: () => void): Updates {
	let ready: string | null = null;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("update-downloaded", info => {
		ready = info.version;
		changed();
		new Notification({ title: `omp agents ${info.version} is ready`, body: "It installs when you quit, or now from the app menu." }).show();
	});
	autoUpdater.on("error", err => console.error(`omp-agents: update check failed: ${errorText(err)}`));
	const check = (): void => void autoUpdater.checkForUpdates().catch(() => {});
	setTimeout(check, FIRST_CHECK_DELAY_MS).unref();
	setInterval(check, CHECK_EVERY_MS).unref();
	return {
		ready: () => ready,
		checkNow: () => void answerCheck(),
		// Silent, and relaunched once installed, as T3 Code installs.
		install() {
			const { promise, reject: failed } = Promise.withResolvers<never>();
			autoUpdater.once("error", failed);
			autoUpdater.quitAndInstall(true, true);
			return promise;
		},
	};
}

/**
 * Answers a check the user asked for from that check's own result and its download, not from the updater's events, which
 * any check fires; a download that succeeds needs no dialog, since it ends in the notification.
 */
async function answerCheck(): Promise<void> {
	let result: UpdateCheckResult | null;
	try {
		result = await autoUpdater.checkForUpdates();
		await result?.downloadPromise;
	} catch (err) {
		dialog.showErrorBox("Update check failed", errorText(err));
		return;
	}
	if (result && !result.isUpdateAvailable) void dialog.showMessageBox({ message: "omp agents is up to date", detail: `Version ${result.updateInfo.version} is the newest.` });
}
