/** The modules the user turned off in Settings › Modules, a portable preference both the page and the server read. */

/** The preference that holds the ids of the modules turned off, as a JSON array; absent, every module is on. */
export const MODULES_OFF_KEY = "omp-agents.modules-off";

/** The module ids `raw` turns off that `isKnown` accepts; anything unreadable turns none off. */
export function parseModulesOff<Id extends string>(raw: string | null | undefined, isKnown: (id: string) => id is Id): Id[] {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "[]");
	} catch {
		return [];
	}
	if (!Array.isArray(stored)) return [];
	return [...new Set(stored.filter((id): id is string => typeof id === "string").filter(isKnown))];
}
