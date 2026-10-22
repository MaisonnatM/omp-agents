/** Where a Summary section's collapse leaves its details' scroller. */

/** A heading pinned to the scroller's top edge can sit a subpixel below it. */
const STICKY_EDGE_TOLERANCE = 1;

/**
 * The scroller's `scrollTop` that keeps a collapsing section's pinned heading where it is, or `null` when the section's
 * top is still in view and the collapse moves nothing above the reader.
 */
export function sectionCollapseAnchorScrollTop({ scrollTop, viewportTop, sectionTop, headingTop }: { scrollTop: number; viewportTop: number; sectionTop: number; headingTop: number }): number | null {
	if (sectionTop >= viewportTop || headingTop > viewportTop + STICKY_EDGE_TOLERANCE) return null;
	return Math.max(0, scrollTop + sectionTop - viewportTop);
}
