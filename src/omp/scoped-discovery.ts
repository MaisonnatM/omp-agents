import { config, discovery } from "./modules";
import type { OmpSettingsInstance } from "./module-types/config";

let pending: Promise<unknown> = Promise.resolve();
export function withDiscovery<T>(cwd: string, read: (settings: OmpSettingsInstance) => Promise<T>, allowInvalidSettings = false): Promise<T> {
	const next = pending.then(async () => {
		let settings: OmpSettingsInstance;
		try { settings = await config.Settings.loadReadOnly({ cwd }); }
		catch (error) {
			if (!allowInvalidSettings) throw error;
			settings = config.Settings.isolated({});
		}
		const release = discovery.initializeWithSettings(settings);
		try { return await read(settings); } finally { release(); }
	});
	pending = next.catch(() => {});
	return next;
}
