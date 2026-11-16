/** The modules the user turned off in Settings › Modules, kept as a portable preference so every machine and the server see it. */
import { MODULES_OFF_KEY, parseModulesOff } from "../src/shared/modules-off";
import { isWebModuleId, MODULE_LIST, type WebModuleId } from "./modules";
import { useStoredState } from "./stored-state";

const decode = (raw: string | null): ReadonlySet<WebModuleId> => new Set(parseModulesOff(raw, isWebModuleId));

/** In `MODULE_LIST` order, so the same set always stores the same text. */
const encode = (off: ReadonlySet<WebModuleId>): string => JSON.stringify(MODULE_LIST.flatMap(({ id }) => (off.has(id) ? [id] : [])));

/** The modules turned off, the same set until one turns on or off, and a setter that turns module `id` on or off. */
export function useModulesOff(): [ReadonlySet<WebModuleId>, (id: WebModuleId, on: boolean) => void] {
	const [off, setOff] = useStoredState(MODULES_OFF_KEY, decode, encode);
	const setOn = (id: WebModuleId, on: boolean): void =>
		setOff(prev => {
			const next = new Set(prev);
			if (on) next.delete(id);
			else next.add(id);
			return next;
		});
	return [off, setOn];
}
