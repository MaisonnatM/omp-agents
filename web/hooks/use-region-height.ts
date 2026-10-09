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
 * Returns a ref for the region's CONTENT element. The height it reports is the
 * clipping parent's scrollHeight, so inner margins count (the parent's
 * overflow-hidden makes it a block formatting context, so they don't collapse
 * out) and the value stays correct while the animated height is mid-flight.
 * Observing the child rather than the parent keeps the ResizeObserver out of a
 * feedback loop with that animation.
 */
export function useRegionHeight() {
  const roRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const sync = () => {
      const next = el.parentElement?.scrollHeight ?? el.offsetHeight;
      if (next > 0) setHeight(next);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, height] as const;
}
