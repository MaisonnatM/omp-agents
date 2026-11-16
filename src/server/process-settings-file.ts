/** When the idle stops end a session's processes and an idle session's omp, saved in `processes.json` as {@link ProcessSettings}. */
import { ReducerFile } from "../fs";
import { isObject } from "../json";
import { DEFAULT_PROCESS_SETTINGS, parseProcessSettings, type ProcessSettings } from "../shared/processes";

export class ProcessSettingsFile extends ReducerFile<ProcessSettings, [ProcessSettings]> {
	constructor(path: string) {
		super(path, {
			// A file saved before a setting existed, or synced from a machine that runs an older dashboard, takes that setting's default.
			parse: value => (isObject(value) ? (parseProcessSettings({ ...DEFAULT_PROCESS_SETTINGS, ...value })?.ok ?? null) : null),
			holds: "process settings",
			empty: DEFAULT_PROCESS_SETTINGS,
			reduce: (settings, next) =>
				settings.stopIdleAfterMinutes === next.stopIdleAfterMinutes && settings.stopIdleSessionsAfterHours === next.stopIdleSessionsAfterHours ? settings : next,
			// The server that holds the owner lock stops processes by what another server's Settings saved.
			shared: true,
		});
	}
}
