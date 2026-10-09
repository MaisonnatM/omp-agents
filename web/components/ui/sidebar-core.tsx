"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";

export type SidebarSide = "left" | "right";

// ─── SidebarProvider ─────────────────────────────────────────────────────────

/** The row that lays the sidebars out beside the inset. It holds no state:
 *  the dashboard owns each sidebar's open state, width and shortcut. */
const SidebarProvider = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-wrapper"
      className={cn("relative flex min-h-svh w-full", className)}
      {...props}
    />
  )
);
SidebarProvider.displayName = "SidebarProvider";

// ─── SidebarInset ────────────────────────────────────────────────────────────

const SidebarInset = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background",
        className
      )}
      {...props}
    />
  )
);
SidebarInset.displayName = "SidebarInset";

// ─── SidebarInput ────────────────────────────────────────────────────────────

type SidebarInputProps = React.InputHTMLAttributes<HTMLInputElement>;

const SidebarInput = forwardRef<HTMLInputElement, SidebarInputProps>(
  ({ className, ...props }, ref) => {
    const shape = useShape();
    const size = useSize();
    return (
      <input
        ref={ref}
        data-sidebar="input"
        className={cn(
          // Mirrors the InputGroup field ladder: transparent at rest,
          // muted fill + border ring on hover, card fill when focused.
          "w-full bg-transparent px-3 text-foreground placeholder:text-muted-foreground outline-none",
          "ring-1 ring-transparent transition-[background-color,box-shadow] duration-80",
          "hover:bg-muted/50 hover:ring-border",
          "focus:bg-card focus:ring-border",
          "focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          size.variant === "compact" ? "h-7" : "h-8",
          size.text,
          shape.input,
          className
        )}
        {...props}
      />
    );
  }
);
SidebarInput.displayName = "SidebarInput";

// ─── SidebarHeader ───────────────────────────────────────────────────────────

type SidebarSectionProps = HTMLAttributes<HTMLDivElement>;

const SidebarHeader = forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="header"
      className={cn("flex shrink-0 flex-col gap-2 p-2", className)}
      {...props}
    />
  )
);
SidebarHeader.displayName = "SidebarHeader";


export { SidebarProvider, SidebarInset, SidebarInput, SidebarHeader };
