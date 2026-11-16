/** The modules the user turned off in Settings › Modules, a portable preference both the page and the server read. */
import { parseStrings } from "../json";

/** The preference that holds the ids of the modules turned off, as a JSON array; absent, every module is on. */
export const MODULES_OFF_KEY = "omp-agents.modules-off";

/** The module ids `raw` turns off that `isKnown` accepts; anything unreadable turns none off. */
export const parseModulesOff = <Id extends string>(raw: string | null | undefined, isKnown: (id: string) => id is Id): Id[] => [...new Set(parseStrings(raw).filter(isKnown))];
