import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels } from "../shortcuts";

const SIZE = {
	sm: "h-4 min-w-4 rounded-[4px] px-1 text-[10.5px]",
	md: "h-5 min-w-5 rounded-[5px] px-[5px] text-xs",
};

/**
 * A key chip, as Settings › Keyboard and the command menu draw them: a tint of the text's own color with a hairline
 * edge, so it reads on any surface, the inverted tooltip's too. `sm` sits in menus and hints, `md` in lists.
 */
export function Kbd({ size = "md", className, ...props }: ComponentProps<"kbd"> & { size?: keyof typeof SIZE }) {
	return (
		<kbd
			className={cn(
				"inline-flex shrink-0 items-center justify-center bg-current/7 font-sans leading-none font-medium tracking-[0.02em] whitespace-nowrap text-muted-foreground tabular-nums shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,currentColor_6%,transparent)] select-none dark:bg-current/10 dark:shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,currentColor_8%,transparent)]",
				SIZE[size],
				className,
			)}
			{...props}
		/>
	);
}

/** The first key of shortcut `id`, small enough for a sidebar row, and hidden from screen readers, which read the control's own name. */
export function ShortcutChip({ id, className }: { id: ShortcutId; className?: string }) {
	return (
		<Kbd aria-hidden size="sm" className={className}>
			{shortcutLabels(id)[0]}
		</Kbd>
	);
}
