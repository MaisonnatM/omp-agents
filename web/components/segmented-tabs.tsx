import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const SegmentedTabs = TabsPrimitive.Root;
export const SegmentedTabPanel = TabsPrimitive.Content;

export const SegmentedTabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.List ref={ref} className={cn("flex w-fit shrink-0 gap-0.5 rounded-lg bg-input/40 p-0.5", className)} {...props} />
	),
);

export const SegmentedTab = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.Trigger
			ref={ref}
			className={cn(
				"relative inline-flex h-6 min-w-0 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-background/55 hover:text-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-xs/10 dark:hover:bg-input/32 dark:aria-selected:bg-input/72 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60",
				className,
			)}
			{...props}
		/>
	),
);
