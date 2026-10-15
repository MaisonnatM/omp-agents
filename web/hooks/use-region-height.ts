"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Measured layout height for one of the composer's collapsible regions
 * (attachments, queue, suggestions).
 *
 * These animate to a self-measured PIXEL height rather than `height: "auto"`:
 * framer resolves an "auto" target from the element's *visual* (transformed)
 * size, so under a scaled ancestor — the /demo card scales its slide — the
 * region springs out to scale× its real height and snaps back when "auto"
 * lands, which reads as the region ballooning and then correcting. Same
 * treatment as Accordion's content height.
 *
 * Measure the content's layout height and margins, independent of the animated
 * parent's current height and any ancestor transforms. Measuring the parent
 * would keep a shrinking region at its previous height.
 */
export function useRegionHeight() {
  const roRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const sync = () => {
      const style = getComputedStyle(el);
      setHeight(el.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, height] as const;
}
