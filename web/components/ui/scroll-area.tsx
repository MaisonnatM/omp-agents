"use client";

// Adapted from Lina by SameerJS6 (https://lina.sameer.sh) — lina-radix
// scroll-area, on UI SDK's scroll area. Changes from the original: Lina's
// gradient-only ScrollMask is dropped, the scrollbar is restyled to the shape
// system, and tw-animate-css visibility classes are swapped for a plain
// opacity transition. Touch-primary devices keep the browser's own
// scrollbars.

import type { ComponentProps, ReactNode, Ref } from "react";
import {
  ScrollArea as ScrollAreaRoot,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@ui-sdk/react/scroll-area";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useTouchPrimary } from "@/hooks/use-touch-primary";

// How long a scrollbar stays after the pointer leaves or scrolling stops.
// UI SDK counts scrolling as over 150ms after the last scroll event, so a
// scroll reveal lingers 600ms in all.
const SCROLL_HIDE_DELAY_MS = 450;

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps
  extends Omit<ComponentProps<typeof ScrollAreaRoot>, "className" | "children"> {
  className?: string;
  children?: ReactNode;
  viewportClassName?: string;
  /** The element that scrolls, which the root's ref is not. */
  viewportRef?: Ref<HTMLDivElement>;
  /** Which axes get scrollbars. Defaults to `"vertical"`. */
  orientation?: Orientation;
}

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  // Without the custom scrollbars, the browser's own stay, which is what a
  // touch-primary device should show.
  const scrollbars = !useTouchPrimary();

  return (
    <ScrollAreaRoot
      type="hover"
      scrollHideDelay={SCROLL_HIDE_DELAY_MS}
      className={cn("overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaViewport
        ref={viewportRef}
        className={cn(
          "size-full rounded-[inherit]",
          orientation === "vertical" && "!overflow-x-hidden",
          orientation === "horizontal" && "!overflow-y-hidden",
          viewportClassName
        )}
      >
        <ScrollAreaContent>{children}</ScrollAreaContent>
      </ScrollAreaViewport>
      {scrollbars && orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
      {scrollbars && orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      {scrollbars && orientation === "both" && <ScrollAreaCorner />}
    </ScrollAreaRoot>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: Omit<ComponentProps<typeof ScrollAreaScrollbar>, "className"> & {
  className?: string;
}) {
  const shape = useShape();

  return (
    <ScrollAreaScrollbar
      orientation={orientation}
      // Scrollbar show/hide is plain CSS opacity matching the cue fade —
      // 160ms in, 120ms out (exits faster, per the animation guidelines);
      // spring tokens are framer-motion configs and don't apply here.
      className={cn(
        // The 10px track stays as a comfortable hit target; the thumb inside
        // it rests narrow and low-contrast, then widens + darkens on hover so
        // it gets out of the way until you reach for it.
        "group/scrollbar z-20 flex touch-none select-none",
        // Show immediately; on hide, wait out the 160ms thumb shrink before
        // fading so the thumb visibly narrows back first instead of the fade
        // masking it.
        "opacity-0 transition-opacity duration-120 ease-out delay-160",
        "data-[visible]:opacity-100 data-[visible]:duration-160 data-[visible]:delay-0",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "h-2.5 w-full flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaThumb
        className={cn(
          // Fixed surface-relative overlay ramp (8 → 12 → 16%) — same tint
          // direction as the menu hover/active tokens, one notch stronger.
          "relative bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)] active:!bg-[rgb(var(--overlay)/0.16)]",
          shape.bg,
          // -translate nudges the thumb 2px off the container edge; the track
          // (and its 10px hit target) stays flush so edge-throws still land.
          orientation === "vertical" &&
            "mx-auto my-1 w-1 -translate-x-0.5 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "my-auto mx-1 h-1 -translate-y-0.5 group-hover/scrollbar:h-1.5"
        )}
      />
    </ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
