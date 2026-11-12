import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const SegmentedTabs = TabsPrimitive.Root;
export const SegmentedTabPanel = TabsPrimitive.Content;

/**
 * `track`: the tabs sit on a tinted track and the chosen one is raised on it.
 * `pills`: no track, the row wraps when it runs out of room, and the chosen tab is filled in the text's colour, as the Artifacts tab's version numbers are.
 */
type SegmentedVariant = "track" | "pills";

const LIST_VARIANTS: Record<SegmentedVariant, string> = {
	track: "rounded-lg bg-input/40 p-0.5",
	pills: "flex-wrap",
};

const TAB_VARIANTS: Record<SegmentedVariant, string> = {
	track: "px-2.5 hover:bg-background/55 hover:text-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-xs/10 dark:hover:bg-input/32 dark:aria-selected:bg-input/72",
	pills: "min-w-6 px-1.5 tabular-nums not-aria-selected:hover:bg-background/55 not-aria-selected:hover:text-foreground dark:not-aria-selected:hover:bg-input/32 aria-selected:bg-foreground aria-selected:text-background",
};

export const SegmentedTabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: SegmentedVariant }>(
	({ className, variant = "track", ...props }, ref) => (
		<TabsPrimitive.List ref={ref} className={cn("flex w-fit shrink-0 gap-0.5", LIST_VARIANTS[variant], className)} {...props} />
	),
);

export const SegmentedTab = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { variant?: SegmentedVariant }>(
	({ className, variant = "track", ...props }, ref) => (
		<TabsPrimitive.Trigger
			ref={ref}
			className={cn(
				"relative inline-flex h-6 min-w-0 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-xs font-medium text-muted-foreground shadow-none transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60",
				TAB_VARIANTS[variant],
				className,
			)}
			{...props}
		/>
	),
);
