import * as React from "react"
import {
  HoverCard,
  HoverCardContent as HoverCardPrimitiveContent,
  HoverCardTrigger,
} from "@ui-sdk/react/hover-card"

import { cn } from "@/lib/utils"

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitiveContent>) {
  return (
    <HoverCardPrimitiveContent
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "w-64 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden transition-[opacity,scale,translate] duration-150 ease-out motion-reduce:transition-none data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2",
        className
      )}
      {...props}
    />
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
