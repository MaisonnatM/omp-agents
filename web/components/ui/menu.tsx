import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

// A context menu and a dropdown menu share Base UI's menu parts, so the items
// below render in either popup: one item tree can back both openers.

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

/** Opens on right-click, long-press, and, from the keyboard, the context-menu key or Shift+F10. */
function ContextMenuTrigger({
  onKeyDown,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
        // Not every platform raises `contextmenu` for these keys, so open the menu at the focused element.
        event.preventDefault()
        const target = event.target as HTMLElement
        const { left, bottom } = target.getBoundingClientRect()
        target.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: left, clientY: bottom })
        )
      }}
      {...props}
    />
  )
}

const popupClassName =
  "max-h-(--available-height) min-w-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden"

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="z-50 outline-hidden">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(popupClassName, className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<React.ComponentProps<typeof MenuPrimitive.Positioner>, "side" | "align" | "sideOffset" | "alignOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50 outline-hidden"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClassName, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const itemClassName =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"

function MenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      data-variant={variant}
      className={cn(
        itemClassName,
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive data-[variant=destructive]:[&_svg]:text-current!",
        className
      )}
      {...props}
    />
  )
}

function MenuLinkItem({
  className,
  closeOnClick = true,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.LinkItem>) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="menu-link-item"
      closeOnClick={closeOnClick}
      className={cn(itemClassName, className)}
      {...props}
    />
  )
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function MenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menu-shortcut"
      className={cn("ml-auto pl-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuShortcut,
}
