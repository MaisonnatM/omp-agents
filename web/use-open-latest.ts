import { useEffect, useRef } from "react";

/**
 * Opens the latest item once you arrive at a list with nothing open. Arriving is mounting, or `hashFor(null)` changing.
 * `latestId` is `undefined` until the list has loaded and `null` when it holds nothing; the first loaded answer, or an item
 * you open, settles the arrival, so an item added later, or closing the open one, leaves the list as it is.
 */
export function useOpenLatest(hashFor: (id: string | null) => string, openId: string | null, latestId: string | null | undefined): void {
	const list = hashFor(null);
	const latest = latestId == null ? latestId : hashFor(latestId);
	const settled = useRef<string | null>(null);
	useEffect(() => {
		if (settled.current === list || (openId === null && latest === undefined)) return;
		settled.current = list;
		// Replaces the list's history entry, so Back leaves the page instead of landing on it with nothing open.
		if (openId === null && latest) location.replace(latest);
	}, [list, openId, latest]);
}
