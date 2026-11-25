import * as React from "react"
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel as MenuPrimitiveGroupLabel,
  MenuItem as MenuPrimitiveItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem as MenuPrimitiveRadioItem,
  MenuSeparator as MenuPrimitiveSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@ui-sdk/react/menu"
import { IconCheckmark1, IconChevronRightSmall } from "central-icons";

import { cn } from "@/lib/utils"

// A context menu and a dropdown menu are one UI SDK menu with a different
// trigger, so the items below render in either popup.

const popupClassName =
  "max-h-(--available-height) min-w-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden"

/** Opens on right-click, long-press, and, from the keyboard, the context-menu key or Shift+F10. */
const ContextMenuTrigger = MenuContextTrigger

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuContent>) {
  return <MenuContent className={cn(popupClassName, className)} {...props} />
}

function DropdownMenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  ...props
}: React.ComponentProps<typeof MenuContent>) {
  return (
    <MenuContent
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={cn(popupClassName, className)}
      {...props}
    />
  )
}

const itemClassName =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"

function MenuItem({
  className,
  variant = "default",
  ...props
}: Omit<React.ComponentProps<typeof MenuPrimitiveItem>, "destructive"> & {
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitiveItem
      data-variant={variant}
      destructive={variant === "destructive"}
      className={cn(
        itemClassName,
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive data-[variant=destructive]:[&_svg]:text-current!",
        className
      )}
      {...props}
    />
  )
}

/** An item that follows a link, as a click on the link would. */
function MenuLinkItem({
  className,
  href,
  target,
  rel,
  ...props
}: Omit<React.ComponentProps<typeof MenuPrimitiveItem>, "render"> &
  Pick<React.ComponentProps<"a">, "href" | "target" | "rel">) {
  return (
    <MenuPrimitiveItem
      render={<a href={href} target={target} rel={rel} />}
      className={cn(itemClassName, className)}
      {...props}
    />
  )
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitiveSeparator>) {
  return (
    <MenuPrimitiveSeparator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

/** A row that opens its submenu on hover, click, or →; `value` reads the current choice before the chevron. */
function MenuSubmenuTrigger({
  className,
  value,
  children,
  ...props
}: Omit<React.ComponentProps<typeof MenuSubTrigger>, "children"> & { children?: React.ReactNode; value?: React.ReactNode }) {
  return (
    <MenuSubTrigger
      className={cn(itemClassName, "data-open:bg-accent data-open:text-accent-foreground", className)}
      {...props}
    >
      {children}
      <span className="ml-auto flex min-w-0 items-center gap-1 pl-4 text-muted-foreground">
        {value !== undefined && <span className="truncate">{value}</span>}
        <IconChevronRightSmall />
      </span>
    </MenuSubTrigger>
  )
}

function MenuSubmenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenuSubContent>) {
  return (
    <MenuSubContent
      sideOffset={sideOffset}
      className={cn(popupClassName, className)}
      {...props}
    />
  )
}

type CheckItemProps = Omit<React.ComponentProps<typeof MenuCheckboxItem>, "value" | "children"> & {
  children?: React.ReactNode
  /** Names the option in the menu's actions; a generated one by default. */
  value?: string
}

/** A row that turns a setting on and off, drawn as a switch at its end. */
function MenuSwitchItem({
  className,
  children,
  value,
  ...props
}: CheckItemProps) {
  const id = React.useId()
  return (
    <MenuCheckboxItem
      value={value ?? id}
      className={cn(itemClassName, "group", className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="ml-auto inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors group-data-checked:bg-primary motion-reduce:transition-none"
      >
        <span className="size-3 rounded-full bg-background shadow-xs transition-transform group-data-checked:translate-x-3 motion-reduce:transition-none" />
      </span>
    </MenuCheckboxItem>
  )
}

/** A row that picks one of several values, checked at its end while picked, as a filter's values are; it keeps the check's room, so trailing text stays aligned. */
function MenuCheckItem({
  className,
  children,
  value,
  ...props
}: CheckItemProps) {
  const id = React.useId()
  return (
    <MenuCheckboxItem
      value={value ?? id}
      className={cn(itemClassName, className)}
      {...props}
    >
      {children}
      <MenuItemIndicator keepMounted className="ml-auto pl-4 data-unchecked:invisible">
        <IconCheckmark1 />
      </MenuItemIndicator>
    </MenuCheckboxItem>
  )
}

/** A {@link MenuGroup}'s heading, muted above its items, as Capy's menus name their sections. */
function MenuGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitiveGroupLabel>) {
  return (
    <MenuPrimitiveGroupLabel
      className={cn("flex items-center px-2 pt-1.5 pb-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** One choice of a {@link MenuRadioGroup}, checked at its end while chosen; every row keeps the check's room, so trailing text stays aligned. */
function MenuRadioItem({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof MenuPrimitiveRadioItem>, "children"> & { children?: React.ReactNode }) {
  return (
    <MenuPrimitiveRadioItem
      className={cn(itemClassName, className)}
      {...props}
    >
      {children}
      <MenuItemIndicator keepMounted className="ml-auto pl-4 data-unchecked:invisible">
        <IconCheckmark1 />
      </MenuItemIndicator>
    </MenuPrimitiveRadioItem>
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
  Menu as ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  Menu as DropdownMenu,
  MenuTrigger as DropdownMenuTrigger,
  DropdownMenuContent,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub as MenuSubmenu,
  MenuSubmenuTrigger,
  MenuSubmenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuCheckItem,
  MenuSwitchItem,
  MenuRadioGroup,
  MenuRadioItem,
}
