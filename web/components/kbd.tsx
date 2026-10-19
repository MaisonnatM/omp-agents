import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels } from "../shortcuts";

/** A key chip, as the shortcuts dialog draws them. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			className={cn(
				"inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-border bg-background px-1.5 font-sans text-xs text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

/** The first key of shortcut `id`, small enough for a sidebar row, and hidden from screen readers, which read the control's own name. */
export function ShortcutChip({ id, className }: { id: ShortcutId; className?: string }) {
	return (
		<Kbd aria-hidden className={cn("h-5 min-w-5 px-1 text-[11px]", className)}>
			{shortcutLabels(id)[0]}
		</Kbd>
	);
}
