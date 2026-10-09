"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useId,
  forwardRef,
  isValidElement,
  Children,
  type ReactNode,
  type ReactElement,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { useSize, useSizeVariant } from "@/lib/size-context";
import { useIcon } from "@/lib/icon-context";
import { resolveSlotTemplate, slotElement } from "@/components/ui/sidebar-slot";

// ─── SidebarGroup family ─────────────────────────────────────────────────────

interface SidebarGroupContextValue {
  open: boolean;
  toggle: () => void;
  contentId: string;
  /** How many header action buttons overlay the label's right edge — the
   *  collapsible label pads itself so its chevron clears them. */
  actionsCount: number;
}

const SidebarGroupContext = createContext<SidebarGroupContextValue | null>(null);

interface SidebarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Makes the group's SidebarGroupLabel a toggle that collapses everything
   *  rendered after it — a group-level accordion. Uncontrolled by default;
   *  pass `open`/`onOpenChange` to control it. */
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Header controls kept outside the collapsible body; each receives space beside the chevron. */
  headerActions?: ReactNode;
}

const SidebarGroup = forwardRef<HTMLDivElement, SidebarGroupProps>(
  (
    {
      className,
      collapsible = false,
      open: openProp,
      defaultOpen = true,
      onOpenChange,
      headerActions,
      children,
      ...props
    },
    ref
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = openProp ?? uncontrolledOpen;
    const contentId = useId();
    const toggle = useCallback(() => {
      const next = !(openProp ?? uncontrolledOpen);
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }, [openProp, uncontrolledOpen, onOpenChange]);
    // Measured-height collapse: animate between 0 and the content's real
    // offsetHeight — never to "auto", which framer measures wrong under a
    // scaled ancestor.
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    useLayoutEffect(() => {
      if (!collapsible) return;
      const el = contentRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const measure = () => setContentHeight(el.offsetHeight);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [collapsible]);
    const measured = contentHeight !== null;
    // The collapse wrapper must clip while animating, but a permanently
    // clipped box shaves the 2px focus ring off a group's first and last
    // rows — so clipping lifts once an open group has settled.
    const [settled, setSettled] = useState(open);
    useEffect(() => {
      if (!open) setSettled(false);
    }, [open]);

    // Height animates only when THIS group toggles. When the measured height
    // changes underneath it instead — a nested sub-menu collapsing inside the
    // group — the wrapper must snap: a spring re-targeted every frame chases
    // the child's own animation, lands well after it, and drags everything
    // below the group along late. Tracked with a ref so a controlled `open`
    // is covered too, and cleared once the toggle's animation lands.
    const prevOpenRef = useRef(open);
    const togglingRef = useRef(false);
    if (prevOpenRef.current !== open) {
      prevOpenRef.current = open;
      togglingRef.current = true;
    }

    // The header controls stay outside the measured collapse body. An explicit
    // slot avoids trying to identify components by type before they render.
    let inner: ReactNode = children;
    const actionsCount = headerActions ? Children.count(headerActions) : 0;
    if (collapsible) {
      const kids = Children.toArray(children);
      const labelIdx = kids.findIndex(
        (k) => isValidElement(k) && k.type === SidebarGroupLabel
      );
      if (labelIdx !== -1) {
        const rest = kids.slice(labelIdx + 1);
        inner = (
          <>
            {kids.slice(0, labelIdx)}
            {/* Header hover scope: hovering anywhere on the row — the
                overlaid action cluster included, which never :hovers the
                label element itself — reveals the label's chevron. Kept
                position-static so the cluster's absolute box still anchors
                to the group and stays on the rows' action axis. */}
            <div className="group/group-header w-full">
              {kids[labelIdx]}
              {headerActions}
            </div>
            <motion.div
              id={contentId}
              aria-hidden={open ? undefined : true}
              className={cn(
                open && settled ? "overflow-visible" : "overflow-hidden",
                !measured && !open && "h-0"
              )}
              initial={false}
              animate={
                measured
                  ? { height: open ? contentHeight : 0, opacity: open ? 1 : 0 }
                  : { opacity: open ? 1 : 0 }
              }
              // Do NOT simplify this to `open ? spring.moderate : …`. The
              // togglingRef arm is what stops a re-measure from springing —
              // without it a nested collapse makes this wrapper chase its own
              // child and everything below the group moves late.
              transition={
                togglingRef.current
                  ? open
                    ? spring.moderate
                    : spring.moderate.exit
                  : { duration: 0 }
              }
              onAnimationComplete={() => {
                togglingRef.current = false;
                if (open) setSettled(true);
              }}
            >
              <div ref={contentRef} className="flex w-full min-w-0 flex-col">
                {rest}
              </div>
            </motion.div>
          </>
        );
      }
    }

    const ctx = useMemo(
      () => ({ open, toggle, contentId, actionsCount }),
      [open, toggle, contentId, actionsCount]
    );

    return (
      <div
        ref={ref}
        data-sidebar="group"
        data-state={collapsible ? (open ? "open" : "closed") : undefined}
        className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
        {...props}
      >
        <SidebarGroupContext.Provider value={collapsible ? ctx : null}>
          {inner}
        </SidebarGroupContext.Provider>
      </div>
    );
  }
);
SidebarGroup.displayName = "SidebarGroup";

interface SidebarGroupLabelProps extends HTMLAttributes<HTMLDivElement> {
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarGroupLabel = forwardRef<HTMLDivElement, SidebarGroupLabelProps>(
  ({ className, render, asChild, children, ...props }, ref) => {
    const sizeVariant = useSizeVariant();
    const sizeClasses = useSize();
    const group = useContext(SidebarGroupContext);
    const shape = useShape();
    const ChevronRightIcon = useIcon("chevron-right");
    const { template, content } = resolveSlotTemplate(render, asChild, children);

    // Truncate only the leading text; element children (count badges,
    // trailing controls) stay flex siblings so the row's gap keeps spacing
    // them — same split MenuRowLabel does for menu rows.
    const nodes = Children.toArray(content);
    let textEnd = 0;
    while (
      textEnd < nodes.length &&
      (typeof nodes[textEnd] === "string" || typeof nodes[textEnd] === "number")
    ) {
      textEnd++;
    }
    const leadingText = nodes.slice(0, textEnd).join("");
    const labelContent = leadingText ? (
      <>
        <span className="min-w-0 truncate">{leadingText}</span>
        {nodes.slice(textEnd)}
      </>
    ) : (
      content
    );

    // Inside a collapsible group the label becomes the toggle. Design
    // treatment is unchanged — hover only raises the label's contrast and
    // reveals a chevron (kept visible while collapsed as the reopen cue).
    if (group) {
      return slotElement(
        template,
        "button",
        {
          ref: ref as Ref<HTMLElement>,
          type: template ? undefined : "button",
          "data-sidebar": "group-label",
          "aria-expanded": group.open,
          "aria-controls": group.contentId,
          onClick: group.toggle,
          // The action cluster overlays the label's right edge, so the label
          // pads past it — far enough that the hover-revealed chevron lands
          // one cluster gap (4px) to its left and the whole trailing run
          // keeps a single rhythm. Cluster width is 24px per action plus 4px
          // between them; add that gap again, less the 8px the group's
          // padding already gives back: 28n + 6. The cluster is always
          // visible, so the reservation is permanent.
          style:
            group.actionsCount > 0
              ? ({ "--group-actions-pad": `${group.actionsCount * 28 + 6}px` } as CSSProperties)
              : undefined,
          className: cn(
            "flex h-8 w-full shrink-0 cursor-pointer select-none items-center gap-2 px-2 text-left text-muted-foreground/70 outline-none",
            "transition-colors duration-80 hover:text-muted-foreground",
            group.actionsCount > 0 && "pr-[var(--group-actions-pad)]",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
            shape.item,
            sizeVariant === "compact" ? "text-[11px]" : "text-[12px]",
            className
          ),
          ...props,
        },
        <>
          {labelContent}
          {/* The chevron occupies an action-sized box, so it reads as one more
              icon in the row rather than a smaller glyph tacked on the end.
              One chevron-right glyph for both states, sprung 90° to point
              down while the group is open — the motion wrapper is what
              animates: Tailwind's rotate-* sets the standalone CSS `rotate`
              property, which transition-transform never covers. While open
              the whole box collapses to zero width at rest so the label text
              keeps the full row; hover/focus (or an open action popup)
              reveals it. Collapsed keeps it visible as the reopen cue. */}
          {/* No width/opacity transition: animating the box's width slides
              the glyph in from the side — the chevron should simply be
              there once the header is hovered. */}
          <span
            className={cn(
              "ml-auto flex h-6 shrink-0 items-center justify-center overflow-hidden",
              group.open
                ? "w-0 opacity-0 group-hover/group-header:w-6 group-hover/group-header:opacity-100 group-focus-within/group-header:w-6 group-focus-within/group-header:opacity-100 group-has-[[data-sidebar=group-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/group-header:w-6 group-has-[[data-sidebar=group-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/group-header:opacity-100 pointer-coarse:w-6 pointer-coarse:opacity-100"
                : "w-6 opacity-100"
            )}
          >
            <motion.span
              className="inline-flex"
              animate={{ rotate: group.open ? 90 : 0 }}
              transition={spring.fast}
            >
              <ChevronRightIcon
                size={sizeClasses.icon}
                strokeWidth={1.5}
                className="shrink-0"
              />
            </motion.span>
          </span>
        </>
      );
    }

    return slotElement(
      template,
      "div",
      {
        ref: ref as Ref<HTMLElement>,
        "data-sidebar": "group-label",
        className: cn(
          "flex h-8 shrink-0 items-center gap-2 px-2 text-muted-foreground/70 outline-none",
          sizeVariant === "compact" ? "text-[11px]" : "text-[12px]",
          className
        ),
        ...props,
      },
      labelContent
    );
  }
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

interface SidebarGroupActionProps extends HTMLAttributes<HTMLButtonElement> {
  render?: ReactElement;
  asChild?: boolean;
}

/** True while rendering inside a SidebarGroupActions cluster, where each
 *  action sits in the flex row instead of positioning itself absolutely. */
const GroupActionsContext = createContext(false);

const SidebarGroupAction = forwardRef<HTMLButtonElement, SidebarGroupActionProps>(
  ({ className, render, asChild, children, ...props }, ref) => {
    const shape = useShape();
    const sizeClasses = useSize();
    const inCluster = useContext(GroupActionsContext);
    const { template, content } = resolveSlotTemplate(render, asChild, children);
    return slotElement(
      template,
      "button",
      {
        ref: ref as Ref<HTMLElement>,
        type: template ? undefined : "button",
        "data-sidebar": "group-action",
        className: cn(
          inCluster
            ? "relative flex size-6 items-center justify-center text-muted-foreground outline-none"
            // size-6 matches the rows' action hit-box, and right-3.5 puts that
            // 24px box's centre 26px from the sidebar's inner edge — the axis
            // the rows' badges and actions already sit on.
            : "absolute right-3.5 top-3 flex size-6 items-center justify-center text-muted-foreground outline-none",
          "hover:bg-hover hover:text-foreground transition-colors duration-80",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          // Normalize bare icons to the site's 1.5 stroke (library defaults
          // vary), thickening to 2 on hover — the same treatment Button's
          // icon-only span applies.
          "[&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 hover:[&_svg]:stroke-[2]",
          shape.item,
          className
        ),
        ...props,
        // After ...props: the spread would otherwise replace this object
        // wholesale and drop the icon-size the glyph is sized from.
        style: {
          ...({ "--icon-size": `${sizeClasses.icon}px` } as CSSProperties),
          ...(props.style ?? {}),
        },
      },
      content
    );
  }
);
SidebarGroupAction.displayName = "SidebarGroupAction";

/** Header action cluster: 1–3 SidebarGroupActions laid out in a row over the
 *  group label's right edge. Use instead of a lone SidebarGroupAction when a
 *  section needs several controls. */
type SidebarGroupActionsProps = HTMLAttributes<HTMLDivElement>;

const SidebarGroupActions = forwardRef<HTMLDivElement, SidebarGroupActionsProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-sidebar="group-actions"
        className={cn(
          // right-3.5 lands the last 24px action's centre 26px from the
          // sidebar's inner edge — the rows' badge/action axis, so the header's
          // controls line up with the column below them.
          "absolute right-3.5 top-2 z-10 flex h-8 items-center gap-1",
          className
        )}
        {...props}
      >
        <GroupActionsContext.Provider value={true}>
          {children}
        </GroupActionsContext.Provider>
      </div>
    );
  }
);
SidebarGroupActions.displayName = "SidebarGroupActions";

export {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupActions,
};
