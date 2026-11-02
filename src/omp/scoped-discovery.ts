import { SerialLane } from "../serial-lane";
import { config, discovery } from "./modules";
import type { OmpSettingsInstance } from "./module-types/config";
import { loadSessionSettings } from "./config";

const reads = new SerialLane();

export function withDiscovery<T>(
	cwd: string,
	read: (settings: OmpSettingsInstance) => Promise<T>,
	options: { allowInvalidSettings?: boolean } = {},
): Promise<T> {
	return reads.run(async () => {
		let settings: OmpSettingsInstance;
		try {
			settings = await loadSessionSettings(cwd);
		} catch (error) {
			if (!options.allowInvalidSettings) throw error;
			settings = config.Settings.isolated({});
		}
		const release = discovery.initializeWithSettings(settings);
		try {
			return await read(settings);
		} finally {
			release();
		}
	});
}
