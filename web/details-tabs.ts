import { updateStored } from "./stored-state";

/**
 * The tabs a details sidebar has open, in order, and the one on screen; the sidebar's first tab, such as Overview, is
 * always open, so `open` leaves it out and an `active` of `null` shows it.
 */
export interface DetailsTabs {
	open: readonly string[];
	active: string | null;
}

/**
 * Reads what a sidebar stored. Any other value, such as one that is not JSON, is read as a single tab name stored before
 * tabs could close, and opens that tab; a name no tab of the sidebar has stays stored, and the sidebar shows none for it.
 */
export function decodeDetailsTabs(raw: string | null): DetailsTabs {
	if (raw === null) return { open: [], active: null };
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value === "object" && value !== null && "open" in value && Array.isArray(value.open)) {
			const open = value.open.filter((each): each is string => typeof each === "string");
			const active = "active" in value && typeof value.active === "string" && open.includes(value.active) ? value.active : null;
			return { open, active };
		}
	} catch {}
	return { open: [raw], active: raw };
}

export const encodeDetailsTabs = (tabs: DetailsTabs): string => JSON.stringify(tabs);

/** Shows `value`: the sidebar's `first` tab, which stays out of `open`, or another, opened as the last tab when it is not open yet. */
export function showDetailsTab({ open }: DetailsTabs, value: string, first: string): DetailsTabs {
	if (value === first) return { open, active: null };
	return { open: open.includes(value) ? open : [...open, value], active: value };
}

/** Closes `value`; closing the tab on screen shows the one before it among those `shown`, the first tab at the least. */
export function closeDetailsTab({ open, active }: DetailsTabs, value: string, shown: readonly string[]): DetailsTabs {
	const rest = open.filter(each => each !== value);
	if (active !== value) return { open: rest, active };
	const before = shown.slice(0, shown.indexOf(value)).findLast(each => rest.includes(each));
	return { open: rest, active: before ?? null };
}

/** Shows `value` in the sidebar stored under `key`, whose first tab is `first`, as a reply's Review visuals does with the Browser. */
export function revealDetailsTab(key: string, value: string, first: string): void {
	updateStored(key, decodeDetailsTabs, encodeDetailsTabs, tabs => showDetailsTab(tabs, value, first));
}
