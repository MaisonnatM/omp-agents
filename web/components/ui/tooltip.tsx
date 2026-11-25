"use client";

import { useEffect, Fragment, type ReactNode } from "react";
import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import { motion, useMotionValue } from "framer-motion";
import { Kbd } from "@/components/kbd";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";

type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: ReactNode;
  /** Keys that run the trigger's action, drawn as chips after `content`: `["⌘/", "?"]` reads `⌘/ or ?`. */
  shortcut?: readonly string[];
  children: React.ReactElement;
  /** The child is a disabled control: anchor hover to a non-focusable wrapper, without making the control operable. */
  disabled?: boolean;
  /** Classes for the wrapper a `disabled` child gets, such as `min-w-0` so a shrinking child can still shrink. */
  wrapperClassName?: string;
  side?: TooltipSide;
  sideOffset?: number;
  /** Hover delay before this tooltip opens, in ms. Defaults to 200; once one tooltip shows, the next opens at once. */
  delayDuration?: number;
  className?: string;
  /** Extra classes for the content element, outside the surface, such as `pointer-events-none`. */
  contentClassName?: string;
  /** When true, forces the tooltip open. When false, forces it closed. When undefined, uses default hover/focus behavior. */
  forceOpen?: boolean;
  /** Follow the cursor along one axis while hovering the trigger — for tall
   *  or wide triggers (the Sidebar rail) where a centered tooltip sits far
   *  from the pointer. The other axis stays anchored by `side`. */
  followCursor?: "x" | "y";
  /** Called when the tooltip's internal open state changes (before forceOpen is applied). */
  onOpenChange?: (open: boolean) => void;
}

/** Keystroke chip rendered inside the (inverted) tooltip surface. */
function TooltipKbd({ children }: { children: ReactNode }) {
  return (
    <Kbd size="sm" className="-my-1 text-background/80">
      {children}
    </Kbd>
  );
}

function Tooltip({
  content,
  shortcut,
  children,
  disabled = false,
  wrapperClassName,
  side = "top",
  sideOffset = 8,
  delayDuration = 200,
  className,
  contentClassName,
  forceOpen,
  onOpenChange,
  followCursor,
}: TooltipProps) {
  const shape = useShape();

  // Cursor-follow offset from the trigger's center, driven as a motion value
  // so per-move updates skip React re-renders.
  const followOffset = useMotionValue(0);
  // A force-opened follow-cursor tooltip has no cursor to follow — it rests
  // centered on the trigger until a real pointer takes over.
  useEffect(() => {
    if (forceOpen && followCursor) followOffset.set(0);
  }, [forceOpen, followCursor, followOffset]);
  const handleFollowMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    followOffset.set(
      followCursor === "y"
        ? event.clientY - (rect.top + rect.height / 2)
        : event.clientX - (rect.left + rect.width / 2)
    );
  };

  return (
    <TooltipPrimitive delay={delayDuration} open={forceOpen} onOpenChange={(open) => onOpenChange?.(open)}>
      <TooltipTrigger
        render={disabled ? <span className={cn("inline-flex", wrapperClassName)}>{children}</span> : children}
        onPointerMove={followCursor ? handleFollowMove : undefined}
      />
      <TooltipContent
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none data-instant:transition-none data-starting-style:opacity-0 data-ending-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=top]:data-starting-style:translate-y-1",
          contentClassName
        )}
      >
        <motion.div
          className={cn(
            // Trim recenters the label; the padding bump only applies
            // where text-box is supported, keeping the same overall
            // height (~26px) as untrimmed browsers.
            "max-w-64 text-pretty bg-foreground text-background text-[12px] px-2 py-1",
            "[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both]:py-2",
            shape.bg,
            className
          )}
          style={{
            fontVariationSettings: fontWeights.medium,
            ...(followCursor === "y" ? { y: followOffset } : followCursor === "x" ? { x: followOffset } : undefined),
          }}
        >
          {shortcut?.length ? (
            // A flex row escapes the surface's text-box trim, so the
            // label re-applies it; otherwise the row would sit taller
            // than a tooltip without chips.
            <span className="flex items-center gap-1.5">
              <span className="[text-box:trim-both_cap_alphabetic]">{content}</span>
              {shortcut.map((key, index) => (
                <Fragment key={key}>
                  {index > 0 && <span className="text-background/60 [text-box:trim-both_cap_alphabetic]">or</span>}
                  <TooltipKbd>{key}</TooltipKbd>
                </Fragment>
              ))}
            </span>
          ) : (
            content
          )}
        </motion.div>
      </TooltipContent>
    </TooltipPrimitive>
  );
}

export { Tooltip };
export type { TooltipProps, TooltipSide };
