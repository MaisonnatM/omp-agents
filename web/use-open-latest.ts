import { useEffect, useRef } from "react";

/**
 * Opens the list's first item once you arrive at it with nothing open. Arriving is mounting, or `hashFor(null)` changing.
 * The first answer once `ready`, or an item you open, settles the arrival, so an item added later, or closing the open
 * one, leaves the list as it is.
 */
export function useOpenLatest<T>(hashFor: (target: T | null) => string, open: T | null, latestTarget: T | null, ready: boolean): void {
	const list = hashFor(null);
	const latest = latestTarget === null ? null : hashFor(latestTarget);
	const closed = open === null;
	const settled = useRef<string | null>(null);
	useEffect(() => {
		if (settled.current === list || (closed && !ready)) return;
		settled.current = list;
		// Replaces the list's history entry, so Back leaves the page instead of landing on it with nothing open.
		if (closed && latest !== null) location.replace(latest);
	}, [list, closed, latest, ready]);
}
