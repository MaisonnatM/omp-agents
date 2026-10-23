/** When the idle stop ends a session's processes, saved in `processes.json` as {@link ProcessSettings}. */
import { ReducerFile } from "../fs";
import { DEFAULT_PROCESS_SETTINGS, parseProcessSettings, type ProcessSettings } from "../shared/processes";

export class ProcessSettingsFile extends ReducerFile<ProcessSettings, [ProcessSettings]> {
	constructor(path: string) {
		super(path, {
			parse: value => parseProcessSettings(value)?.ok ?? null,
			holds: "process settings",
			empty: DEFAULT_PROCESS_SETTINGS,
			reduce: (settings, next) => (settings.stopIdleAfterMinutes === next.stopIdleAfterMinutes ? settings : next),
			// The server that holds the owner lock stops processes by what another server's Settings saved.
			shared: true,
		});
	}
}
