/** A vertical rail of rows, top first, down to an end row: a pull request's stack down to its base branch, an issue's sub-issues down to the issue. */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const RAIL = "absolute left-3.5 w-px bg-muted-foreground/30";
const RAIL_DOT = "absolute top-1/2 left-[10.5px] size-2 -translate-y-1/2 rounded-full ring-2 ring-background";

/** The rail's list; `end` is the last row, where the rail stops. */
export function Rail({ end, className, children }: { end: ReactNode; className?: string; children: ReactNode }) {
	return (
		<ol className={cn("py-1", className)}>
			{children}
			<li className="relative py-1.5 pr-3 pl-8 font-mono text-xs text-muted-foreground">
				<span aria-hidden className={cn(RAIL, "top-0 bottom-1/2")} />
				<span aria-hidden className={cn(RAIL_DOT, "bg-background ring-muted-foreground/60")} />
				{end}
			</li>
		</ol>
	);
}

/** One row on the rail; the `first` row's rail starts at its dot, and the `here` row is marked. */
export function RailRow({ first, here = false, children }: { first: boolean; here?: boolean; children: ReactNode }) {
	return (
		<li className={cn("relative flex items-center gap-2 py-1.5 pr-3 pl-8 text-sm", here && "bg-muted/60")}>
			<span aria-hidden className={cn(RAIL, first ? "top-1/2" : "top-0", "bottom-0")} />
			<span aria-hidden className={cn(RAIL_DOT, here ? "bg-primary" : "bg-muted-foreground/60")} />
			{children}
		</li>
	);
}
