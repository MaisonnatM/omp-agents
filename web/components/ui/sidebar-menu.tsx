"use client";

import {
  useContext,
  useLayoutEffect,
  useCallback,
  useRef,
  forwardRef,
  Children,
  type ReactNode,
  type ReactElement,
  type CSSProperties,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ButtonHTMLAttributes,
  type Ref,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { useSize, SizeProvider, type SizeVariant } from "@/lib/size-context";
import type { IconComponent } from "@/lib/icon-context";
import { resolveSlotTemplate, slotElement } from "@/components/ui/sidebar-slot";
import {
  MenuRegistryContext,
  MenuRowsContext,
  useMenuScope,
} from "@/components/ui/sidebar-menu-scope";
import {
  MenuActionsClusterContext,
  MenuItemContext,
  rowGutter,
  useMenuRow,
} from "@/components/ui/sidebar-menu-row";

// ─── SidebarMenu ─────────────────────────────────────────────────────────────

interface SidebarMenuProps extends HTMLAttributes<HTMLUListElement> {
  /** Pins the menu's rows to one step of the size ladder. Omitted, they
   *  follow the surrounding SizeProvider. */
  size?: SizeVariant;
  /** Draw the traveling keyboard focus ring. Off, keyboard focus moves the
   *  hover background only. @default true */
  focusRing?: boolean;
}

const SidebarMenu = forwardRef<HTMLUListElement, SidebarMenuProps>(
  ({ className, size, focusRing, children, ...props }, ref) => {
    const containerRef = useRef<HTMLUListElement>(null);
    const { registry, rows, containerProps, overlays } = useMenuScope(containerRef, { focusRing });

    const content = (
      <MenuRegistryContext.Provider value={registry}>
      <MenuRowsContext.Provider value={rows}>
        <ul
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLUListElement | null>).current = node;
          }}
          data-sidebar="menu"
          className={cn("relative flex w-full min-w-0 flex-col gap-0.5 select-none", className)}
          {...containerProps}
          {...props}
        >
          {overlays}
          {children}
        </ul>
      </MenuRowsContext.Provider>
      </MenuRegistryContext.Provider>
    );

    return size ? <SizeProvider size={size}>{content}</SizeProvider> : content;
  }
);
SidebarMenu.displayName = "SidebarMenu";

// ─── SidebarMenuItem ─────────────────────────────────────────────────────────

type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement>;

const SidebarMenuItem = forwardRef<HTMLLIElement, SidebarMenuItemProps>(
  ({ className, children, ...props }, ref) => {
    const rowRef = useRef<HTMLLIElement>(null);
    const item = useMenuRow(rowRef);
    const { attachRow } = item;
    // Stable ref callback: an inline one is detached and re-attached around
    // every re-render, and child layout effects fire inside that null window.
    const refCb = useCallback(
      (node: HTMLLIElement | null) => {
        attachRow(node);
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLLIElement | null>).current = node;
      },
      [attachRow, ref]
    );
    return (
      <MenuItemContext.Provider value={item}>
        <li
          ref={refCb}
          data-sidebar="menu-item"
          className={cn("group/menu-item relative", className)}
          {...props}
        >
          {children}
        </li>
      </MenuItemContext.Provider>
    );
  }
);
SidebarMenuItem.displayName = "SidebarMenuItem";

// ─── Row label (ghost-span weight animation) ─────────────────────────────────

/** A resting row's text: muted, lit while the fluid hover marks its button. */
const LIT_ON_HOVER =
  "text-muted-foreground group-data-[fluid-hover-active]/menu-button:text-foreground";

/** Splits leading string children out as the label so it can get the
 *  ghost-span weight treatment; remaining element children (dots, trailing
 *  icons) render as flex siblings after it — outside the text-box-trimmed
 *  span, which would clip an inline SVG, and where `ml-auto` can push a
 *  trailing control to the row's end. */
function MenuRowLabel({
  content,
  active,
  textClass,
}: {
  content: ReactNode;
  /** Lit and emphasized for good; otherwise the label lights while its
   *  button is hovered. */
  active: boolean;
  textClass: string;
}) {
  const nodes = Children.toArray(content);
  const textParts: string[] = [];
  let i = 0;
  while (i < nodes.length && (typeof nodes[i] === "string" || typeof nodes[i] === "number")) {
    textParts.push(String(nodes[i]));
    i++;
  }
  const label = textParts.join("");
  const rest = nodes.slice(i);

  if (!label) {
    return (
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 transition-colors duration-80",
          active ? "text-foreground" : LIT_ON_HOVER,
          textClass
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <>
      <span className={cn("inline-grid min-w-0 text-left", textClass)}>
        {/* Ghost: reserves width at the heaviest weight, hidden from AT.
            Both cells truncate so a long label clips with an ellipsis
            instead of wrapping the row. The trim box spans cap height to
            baseline, so the overflow clip would shave ascenders and
            descenders — symmetric padding extends the clip box past both
            and the negative margins cancel it out of the row's height. */}
        <span
          className="col-start-1 row-start-1 invisible truncate pt-[0.25em] -mt-[0.25em] pb-[0.25em] -mb-[0.25em] [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {label}
        </span>
        {/* Visible: animates between weights in the same cell */}
        <span
          className={cn(
            "col-start-1 row-start-1 truncate pt-[0.25em] -mt-[0.25em] pb-[0.25em] -mb-[0.25em] transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            active ? "text-foreground" : LIT_ON_HOVER
          )}
          style={{
            fontVariationSettings: active ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
      {rest}
    </>
  );
}

// ─── SidebarMenuButton ───────────────────────────────────────────────────────

const sidebarMenuButtonVariants = cva(
  // The trailing gutter is an exact reservation published by the row (see
  // rowGutter): --row-gutter at rest, --row-gutter-hover once hover-revealed
  // actions are showing. One rule per state instead of a class per
  // count/badge/reveal combination.
  // Disabled stays in the layout, and pointer events pass through it to the
  // row, since a browser sends no mouse events to a disabled button: the
  // container keeps seeing the moves, and fluid hover simply never lights it.
  // `group/menu-button` lets the icon, dot and label light from the
  // `data-fluid-hover-active` mark the menu's hover puts on this button.
  "peer/menu-button group/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 pl-2 text-left outline-none disabled:opacity-50 disabled:pointer-events-none transition-[padding] duration-80 pr-[var(--row-gutter)] group-hover/menu-item:pr-[var(--row-gutter-hover)] group-focus-within/menu-item:pr-[var(--row-gutter-hover)] group-hover/menu-sub-item:pr-[var(--row-gutter-hover)] group-focus-within/menu-sub-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-sub-item:pr-[var(--row-gutter-hover)]",
  {
    variants: {
      variant: {
        default: "",
        outline: "border border-border bg-background",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

interface SidebarMenuButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  isActive?: boolean;
  size?: "default" | "sm" | "lg";
  icon?: IconComponent;
  /** Semantic thread state for status-dot navigation. Drives the dot
   *  visuals (`active`/`unread` → filled, `idle` → ring), stamps
   *  `data-status` on the button, appends visually-hidden "unread" text for
   *  screen readers, and `"active"` implies `isActive`. */
  status?: "active" | "unread" | "idle";
  /** Visual-only dot in the icon column — the escape hatch when the
   *  semantic `status` vocabulary doesn't fit. Overrides the dot derived
   *  from `status`. Ignored when `icon` is set. */
  dot?: "filled" | "ring";
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarMenuButton = forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  (
    {
      isActive = false,
      size = "default",
      variant,
      icon: Icon,
      status,
      dot,
      render,
      asChild,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const rows = useContext(MenuRowsContext);
    const item = useContext(MenuItemContext);
    const shape = useShape();
    const sizeClasses = useSize();
    const buttonRef = useRef<HTMLElement | null>(null);

    // status="active" implies the row-active treatment; an explicit dot
    // overrides the status-derived one.
    const effectiveActive = isActive || status === "active";

    const setActive = item?.setActive;
    useLayoutEffect(() => {
      setActive?.(effectiveActive);
      return () => setActive?.(false);
    }, [effectiveActive, setActive]);

    const setButtonEl = item?.setButtonEl;
    useLayoutEffect(() => {
      setButtonEl?.(buttonRef.current);
      return () => setButtonEl?.(null);
    }, [setButtonEl]);
    const resolvedDot =
      dot ?? (status ? (status === "idle" ? "ring" : "filled") : undefined);
    const heightClass =
      size === "sm"
        ? "h-7"
        : size === "lg"
          ? "h-12"
          : sizeClasses.variant === "compact"
            ? "h-7"
            : "h-8";
    const textClass = size === "sm" ? "text-[12px]" : sizeClasses.text;

    // Roving tabindex: the active rows' buttons are the menu's tab stops; with
    // no active row, the menu's first row keeps it keyboard-reachable.
    const row = item?.rowRef.current ?? null;
    const tabIdx = effectiveActive
      ? 0
      : rows?.hasActive
        ? -1
        : row !== null && row === rows?.firstRowEl
          ? 0
          : -1;

    // Exact trailing reservation: at rest, hover-revealed actions claim no
    // width (the label owns the row); once revealed the row widens to
    // --row-gutter-hover.
    const gutterHover = rowGutter(item?.actionCount ?? 0, item?.hasBadge ?? false);
    const gutterRest = item?.actionsShowOnHover
      ? rowGutter(0, item?.hasBadge ?? false)
      : gutterHover;
    const gutterVars = {
      "--row-gutter": `${gutterRest}px`,
      "--row-gutter-hover": `${gutterHover}px`,
    } as CSSProperties;

    const { template, content } = resolveSlotTemplate(render, asChild, children);

    const inner = (
      <>
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={effectiveActive ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              effectiveActive
                ? "text-foreground"
                : "text-muted-foreground group-data-[fluid-hover-active]/menu-button:text-foreground group-data-[fluid-hover-active]/menu-button:stroke-2"
            )}
          />
        )}
        {!Icon && resolvedDot && (
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: sizeClasses.icon, height: sizeClasses.icon }}
          >
            <span
              className={cn(
                "size-2 rounded-full transition-colors duration-80",
                resolvedDot === "filled"
                  ? effectiveActive
                    ? "bg-foreground/60"
                    : "bg-muted-foreground/50 group-data-[fluid-hover-active]/menu-button:bg-foreground/60"
                  : effectiveActive
                    ? "border border-foreground/60"
                    : "border border-muted-foreground/50 group-data-[fluid-hover-active]/menu-button:border-foreground/60"
              )}
            />
          </span>
        )}
        <MenuRowLabel content={content} active={effectiveActive} textClass={textClass} />
        {status === "unread" && <span className="sr-only">, unread</span>}
      </>
    );

    return slotElement(
      template,
      "button",
      {
        ref: (node: HTMLElement | null) => {
          buttonRef.current = node;
          if (typeof ref === "function") ref(node as HTMLButtonElement | null);
          else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = node;
        },
        type: template ? undefined : "button",
        "data-sidebar": "menu-button",
        "data-size": size,
        "data-active": effectiveActive ? "true" : undefined,
        "data-status": status,
        "aria-current": effectiveActive ? "page" : undefined,
        tabIndex: tabIdx,
        className: cn(
          sidebarMenuButtonVariants({ variant }),
          heightClass,
          shape.item,
          className
        ),
        ...props,
        style: { ...gutterVars, ...(props.style ?? {}) },
      },
      inner
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

// ─── SidebarMenuAction ───────────────────────────────────────────────────────

interface SidebarMenuActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  showOnHover?: boolean;
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarMenuAction = forwardRef<HTMLButtonElement, SidebarMenuActionProps>(
  ({ className, showOnHover = false, render, asChild, children, onClick, ...props }, ref) => {
    const shape = useShape();
    const sizeClasses = useSize();
    const item = useContext(MenuItemContext);
    const inCluster = useContext(MenuActionsClusterContext);
    const { template, content } = resolveSlotTemplate(render, asChild, children);

    // A lone action registers its own slot; inside a cluster the wrapper
    // registers the whole count and each action flows in its row.
    const setActions = item?.setActions;
    useLayoutEffect(() => {
      if (inCluster || !setActions) return;
      setActions(1, showOnHover);
      return () => setActions(0, false);
    }, [inCluster, setActions, showOnHover]);
    return slotElement(
      template,
      "button",
      {
        ref: ref as Ref<HTMLElement>,
        type: template ? undefined : "button",
        "data-sidebar": "menu-action",
        "data-show-on-hover": showOnHover ? "" : undefined,
        className: cn(
          // right-1.5 centers the 24px hit-box on the same axis as the badge
          // (right-2 + min-w-5): both land 18px from the row's right edge.
          // With a badge on the same row the badge keeps that rightmost spot
          // and the action slides left of it. Inside a cluster the wrapper
          // owns the positioning and actions simply flow.
          inCluster
            ? "relative flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none"
            : "absolute right-1.5 z-10 flex size-6 items-center justify-center text-muted-foreground outline-none",
          !inCluster &&
            (item?.isSubRow
              ? "group-has-[>[data-sidebar=menu-badge]]/menu-sub-item:right-8.5"
              : "group-has-[>[data-sidebar=menu-badge]]/menu-item:right-8.5"),
          !inCluster &&
            (item?.isSubRow || sizeClasses.variant === "compact" ? "top-0.5" : "top-1"),
          "hover:bg-hover hover:text-foreground transition-[color,background-color,opacity] duration-80",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          // One icon size across the sidebar: row actions match the leading
          // icons and the section header's actions, all on the size ladder.
          // Normalize bare icons to the site's 1.5 stroke (library defaults
          // vary), thickening to 2 on hover — Button's icon-only treatment.
          "[&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 hover:[&_svg]:stroke-[2]",
          shape.item,
          // Reveal on the OWN row only. A sub action must not use the
          // menu-item group — its nearest one is the parent li, which would
          // light every sibling sub action on any hover inside the sub-tree.
          !inCluster &&
            showOnHover &&
            (item?.isSubRow
              ? "opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 data-[state=open]:opacity-100 aria-expanded:opacity-100"
              // Tracks the row's own button (its peer), not the <li> — a row
              // that hosts a sub-menu wraps its children too, and hovering a
              // child should not light the parent's action.
              : "opacity-0 peer-hover/menu-button:opacity-100 peer-focus-visible/menu-button:opacity-100 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 aria-expanded:opacity-100"),
          className
        ),
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          // The action often sits on a row composed via `render` — keep its
          // click from also triggering the row.
          event.stopPropagation();
          onClick?.(event);
        },
        ...props,
        style: { ...({ "--icon-size": `${sizeClasses.icon}px` } as CSSProperties), ...(props.style ?? {}) },
      },
      content
    );
  }
);
SidebarMenuAction.displayName = "SidebarMenuAction";

// ─── SidebarMenuBadge ────────────────────────────────────────────────────────

type SidebarMenuBadgeProps = HTMLAttributes<HTMLDivElement>;

const SidebarMenuBadge = forwardRef<HTMLDivElement, SidebarMenuBadgeProps>(
  ({ className, ...props }, ref) => {
    const item = useContext(MenuItemContext);
    const sizeClasses = useSize();
    const active = item?.isActiveRow ?? false;

    const setHasBadge = item?.setHasBadge;
    useLayoutEffect(() => {
      setHasBadge?.(true);
      return () => setHasBadge?.(false);
    }, [setHasBadge]);
    return (
      <div
        ref={ref}
        data-sidebar="menu-badge"
        className={cn(
          "pointer-events-none absolute right-2 z-10 flex h-5 min-w-5 items-center justify-center px-1 tabular-nums",
          sizeClasses.variant === "compact" ? "top-1 text-[10px]" : "top-1.5 text-[11px]",
          "transition-[color,font-variation-settings] duration-80",
          active ? "text-foreground" : "text-muted-foreground",
          className
        )}
        style={{
          fontVariationSettings: active ? fontWeights.semibold : fontWeights.normal,
        }}
        {...props}
      />
    );
  }
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

export {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
};
