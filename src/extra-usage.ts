/** The composer's Extra usage switch: the fallback lists it parks, and whether the switch is on. */
import { ReducerFile } from "./fs";
import { arrayOf, isObject, isString, recordOf } from "./json";
import { extraUsageFile } from "./paths";

/** `retry.fallbackChains` as configured, before omp copies the `default` chain onto other roles. */
export type FallbackChains = Record<string, string[]>;

/** The chains the switch put aside, or none while it is off. */
interface ParkedChains {
	chains: FallbackChains | null;
}

const isChains = recordOf(arrayOf(isString));

const parseParked = (json: unknown): ParkedChains | null => {
	if (!isObject(json)) return null;
	if (json.chains === null) return { chains: null };
	return isChains(json.chains) ? { chains: json.chains } : null;
};

/** A chain list with at least one model in it. An empty map is what the switch writes while it is on. */
const hasFallback = (chains: FallbackChains): boolean => Object.values(chains).some(chain => chain.length > 0);

/**
 * Whether Extra usage is on. A parked list with live fallbacks is off, because a later edit of the chains put them back.
 */
export const extraUsageOn = (chains: FallbackChains, parked: FallbackChains | null): boolean => parked !== null && !hasFallback(chains);

/**
 * The chains to write, and the list to keep parked, for turning Extra usage `on` or off.
 * Turning it on parks the live lists when they still hold a model, and clears them.
 * Turning it off writes the parked lists back and forgets them. A second on keeps the parked lists.
 */
export function extraUsageChange(chains: FallbackChains, parked: FallbackChains | null, on: boolean): { chains: FallbackChains; parked: FallbackChains | null } {
	if (on) return { chains: {}, parked: hasFallback(chains) ? chains : (parked ?? {}) };
	return { chains: parked ?? chains, parked: null };
}

const parkedFile = new ReducerFile<ParkedChains, []>(extraUsageFile, {
	parse: parseParked,
	holds: "the fallback lists Extra usage parked",
	empty: { chains: null },
	reduce: value => value,
	shared: true,
});

/** The fallback lists Extra usage parked, read again so another dashboard's save counts. */
export function parkedFallbacks(): FallbackChains | null {
	parkedFile.reload();
	return parkedFile.value.chains;
}

/** Replaces the parked lists. `null` is the switch off. */
export function parkFallbacks(chains: FallbackChains | null): void {
	parkedFile.replace({ chains });
}
