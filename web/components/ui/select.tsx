import * as React from "react"
import {
  Select,
  SelectContent as SelectPrimitiveContent,
  SelectItem as SelectPrimitiveItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger as SelectPrimitiveTrigger,
  SelectValue as SelectPrimitiveValue,
} from "@ui-sdk/react/select"
import { IconCheckmark1, IconChevronDownSmall } from "central-icons";

import { cn } from "@/lib/utils"

function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitiveValue>) {
  return (
    <SelectPrimitiveValue
      className={cn("flex flex-1 truncate text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitiveTrigger>, "children"> & { children?: React.ReactNode }) {
  return (
    <SelectPrimitiveTrigger
      className={cn(
        "flex h-7 w-fit items-center justify-between gap-1.5 rounded-md border border-border bg-background pr-1.5 pl-2 text-sm whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground data-open:bg-accent",
        className
      )}
      {...props}
    >
      {children}
      <span aria-hidden className="pointer-events-none flex shrink-0 text-muted-foreground">
        <IconChevronDownSmall className="size-3.5" />
      </span>
    </SelectPrimitiveTrigger>
  )
}

function SelectContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitiveContent>) {
  return (
    <SelectPrimitiveContent
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className={cn(
        "relative max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden",
        className
      )}
      {...props}
    />
  )
}

function SelectItem<T = string>({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitiveItem<T>>, "children"> & { children?: React.ReactNode }) {
  return (
    <SelectPrimitiveItem<T>
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      <SelectItemText className="flex-1 whitespace-nowrap">{children}</SelectItemText>
      <SelectItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <IconCheckmark1 className="size-4 text-muted-foreground" />
      </SelectItemIndicator>
    </SelectPrimitiveItem>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
