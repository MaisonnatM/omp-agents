import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 truncate text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-7 w-fit items-center justify-between gap-1.5 rounded-md border border-border bg-background pr-1.5 pl-2 text-sm whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground data-popup-open:bg-accent",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="pointer-events-none flex shrink-0 text-muted-foreground">
        <ChevronDown aria-hidden className="size-3.5" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50 outline-hidden"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "relative max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden",
            className
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1">
            <ChevronUp aria-hidden className="size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className="bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1">
            <ChevronDown aria-hidden className="size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex-1 whitespace-nowrap">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <Check aria-hidden className="size-4 text-muted-foreground" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
