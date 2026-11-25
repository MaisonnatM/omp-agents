import * as React from "react"
import {
  Popover,
  PopoverContent as PopoverPrimitiveContent,
  PopoverDescription as PopoverPrimitiveDescription,
  PopoverTitle as PopoverPrimitiveTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover"

import { cn } from "@/lib/utils"

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitiveContent>) {
  return (
    <PopoverPrimitiveContent
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden",
        className
      )}
      {...props}
    />
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitiveTitle>) {
  return <PopoverPrimitiveTitle className={cn("font-medium", className)} {...props} />
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<typeof PopoverPrimitiveDescription>) {
  return (
    <PopoverPrimitiveDescription
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
