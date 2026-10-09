"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SidebarSide } from "@/components/ui/sidebar-core";

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarProps extends HTMLAttributes<HTMLDivElement> {
  side?: SidebarSide;
}

/** A fixed panel at the wrapper's edge, bordered on its inner side. Its
 *  width comes from `style`; the dashboard sizes, resizes and hides it. */
const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  ({ side = "left", className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar"
      data-side={side}
      className={cn(
        "sticky top-0 flex h-svh shrink-0 flex-col",
        side === "right" && "order-last",
        className
      )}
      {...props}
    >
      <div
        data-sidebar="sidebar"
        className={cn(
          "flex h-full w-full min-h-0 flex-col",
          side === "left" ? "border-r border-border" : "border-l border-border"
        )}
      >
        {children}
      </div>
    </div>
  )
);
Sidebar.displayName = "Sidebar";

// ─── SidebarContent ──────────────────────────────────────────────────────────

interface SidebarContentProps extends HTMLAttributes<HTMLDivElement> {
  viewportClassName?: string;
}

const SidebarContent = forwardRef<HTMLDivElement, SidebarContentProps>(
  ({ className, viewportClassName, children, ...props }, ref) => (
    // The scroll primitive wraps children in an inline-styled sizer that
    // sizes to content — rows would stop shrinking near the min width
    // instead of truncating, so the viewport's direct child is forced back
    // to a plain shrinkable block.
    <ScrollArea className={cn("scroll-divider min-h-0 w-full flex-1", className)} viewportClassName={cn("scroll-fade scroll-fade-once-scrolled [&>div]:!block [&>div]:!min-w-0", viewportClassName)}>
      <div ref={ref} data-sidebar="content" className="flex w-full min-w-0 flex-col" {...props}>
        {children}
      </div>
    </ScrollArea>
  )
);
SidebarContent.displayName = "SidebarContent";

export { Sidebar, SidebarContent };

// Re-export the other parts so `sidebar` is a one-stop import.
export {
  SidebarProvider,
  SidebarInset,
  SidebarInput,
  SidebarHeader,
} from "@/components/ui/sidebar-core";
export type { SidebarSide } from "@/components/ui/sidebar-core";
export {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupActions,
} from "@/components/ui/sidebar-group";
export {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
} from "@/components/ui/sidebar-menu";
