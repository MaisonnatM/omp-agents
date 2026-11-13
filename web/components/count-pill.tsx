import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** The neutral count pill: how many items need you, after a row's label, a workspace's name, or a tab's (`ui/tabs.tsx` draws it as a `TabItem`'s badge). Hidden from screen readers; the row's name says the count. */
export function CountPill({ count, className, style }: { count: number; className?: string; style?: CSSProperties }) {
	return (
		<span aria-hidden style={style} className={cn("min-w-4 shrink-0 rounded-full bg-foreground/10 px-1 text-center text-[10px] leading-4 font-medium tabular-nums text-foreground", className)}>
			{count}
		</span>
	);
}
