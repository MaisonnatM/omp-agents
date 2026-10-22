/** Whether a pull request's header shows condensed, per tab, driven by the one vertical scroller its details placement names. */
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

const CONDENSE_PAST = 32;
const EXPAND_WITHIN = 4;

/**
 * The header's next state at `scrollTop`, or `null` to keep it. Condensing shrinks the header by `fold - compact`, so `top`
 * is the scroll position that keeps the content under the pointer still; expanding at the top needs none.
 */
export function condenseStep(condensed: boolean, scrollTop: number, fold: number, compact: number): { condensed: boolean; top: number | null } | null {
	if (fold <= 0) return null;
	if (condensed) return scrollTop < EXPAND_WITHIN ? { condensed: false, top: null } : null;
	return scrollTop > fold + CONDENSE_PAST ? { condensed: true, top: scrollTop - (fold - compact) } : null;
}

/**
 * Listens to `scroller` alone, so a nested scroller inside the details, such as the file list or a diff scrolled sideways,
 * never condenses or expands the header. `root` holds the header's `[data-pr-condensed]` row, and `foldRef` the part it hides.
 */
export function useCondensedHeader<T extends string>(scroller: HTMLElement | null, root: HTMLElement | null, foldRef: RefObject<HTMLElement | null>, tab: T): boolean {
	const [condensedByTab, setCondensedByTab] = useState<Partial<Record<T, boolean>>>({});
	const condensed = condensedByTab[tab] ?? false;
	const restore = useRef<number | null>(null);
	useLayoutEffect(() => {
		if (restore.current === null || !scroller) return;
		scroller.scrollTop = restore.current;
		restore.current = null;
	}, [condensed, scroller]);
	useEffect(() => {
		if (!scroller) return;
		const onScroll = (): void => {
			const fold = foldRef.current?.scrollHeight ?? 0;
			const compact = root?.querySelector<HTMLElement>("[data-pr-condensed]")?.scrollHeight ?? 0;
			const step = condenseStep(condensed, scroller.scrollTop, fold, compact);
			if (!step) return;
			restore.current = step.top;
			setCondensedByTab(previous => ({ ...previous, [tab]: step.condensed }));
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, [scroller, root, foldRef, tab, condensed]);
	return condensed;
}
