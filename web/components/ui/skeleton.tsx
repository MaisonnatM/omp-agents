import { cn } from "@/lib/utils";

interface SkeletonProps {
	/** px or any CSS length, the width of what it replaces. */
	width: number | string;
	/** Sits the 12px bar in a box one text line tall, centered in it, so the row keeps its height when the text lands. */
	line?: boolean;
	className?: string;
}

/**
 * A muted 12px bar that stands in for text while it loads, a soft sheen sweeping across it; with reduced motion the
 * sheen is gone. Hidden from screen readers: say what loads beside it.
 */
export function Skeleton({ width, line = false, className }: SkeletonProps) {
	const bar = (
		<span
			aria-hidden
			style={{ width }}
			className={cn(
				"relative block h-3 max-w-full flex-none overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:-translate-x-full after:bg-linear-to-r after:from-transparent after:via-background/70 after:to-transparent after:content-[''] motion-safe:after:animate-[skeleton-sweep_1.6s_cubic-bezier(0.22,1,0.36,1)_infinite] motion-reduce:after:hidden dark:after:via-foreground/6",
				!line && className,
			)}
		/>
	);
	if (!line) return bar;
	return (
		<span aria-hidden className={cn("flex h-[1lh] max-w-full min-w-0 items-center", className)}>
			{bar}
		</span>
	);
}
