/** The modules the user turned off in Settings › Modules, kept as a portable preference so every machine and the server see it. */
import { MODULES_OFF_KEY, parseModulesOff } from "../src/shared/modules-off";
import { isWebModuleId, MODULE_LIST, type WebModuleId } from "./modules";
import { useStoredState } from "./stored-state";

const decode = (raw: string | null): ReadonlySet<WebModuleId> => new Set(parseModulesOff(raw, isWebModuleId));

const encode = (off: ReadonlySet<WebModuleId>): string => JSON.stringify(MODULE_LIST.flatMap(({ id }) => (off.has(id) ? [id] : [])));

/** The modules turned off, the same set until one turns on or off, and a setter that turns module `id` off or back on. */
export function useModulesOff(): [ReadonlySet<WebModuleId>, (id: WebModuleId, off: boolean) => void] {
	const [off, setOff] = useStoredState(MODULES_OFF_KEY, decode, encode);
	const turn = (id: WebModuleId, next: boolean): void => setOff(prev => new Set(MODULE_LIST.flatMap(module => ((module.id === id ? next : prev.has(module.id)) ? [module.id] : []))));
	return [off, turn];
}
