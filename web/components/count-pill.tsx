import { cn } from "@/lib/utils";

/** The neutral count pill that the base's `TabItem` badge draws (`ui/tabs.tsx`): how many items need you, after a row's label. Hidden from screen readers; the row's name says the count. */
export function CountPill({ count, className }: { count: number; className?: string }) {
	return (
		<span aria-hidden className={cn("min-w-4 shrink-0 rounded-full bg-foreground/10 px-1 text-center text-[10px] leading-4 font-medium tabular-nums text-foreground", className)}>
			{count}
		</span>
	);
}
