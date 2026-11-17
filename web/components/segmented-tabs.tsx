import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef, type ForwardedRef, useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const SegmentedTabs = TabsPrimitive.Root;
export const SegmentedTabPanel = TabsPrimitive.Content;

const EASE = "cubic-bezier(0.25, 0.9, 0.3, 1)";

/** The edge the card moves toward leads, the other follows, so it stretches toward the tab, then settles. */
const glide = (lead: "left" | "right"): string => `${lead} 160ms ${EASE}, ${lead === "left" ? "right" : "left"} 220ms ${EASE}, top 160ms ${EASE}, bottom 160ms ${EASE}`;

function useMergedRef<T>(own: { current: T | null }, forwarded: ForwardedRef<T>) {
	return useCallback(
		(node: T | null) => {
			own.current = node;
			if (typeof forwarded === "function") forwarded(node);
			else if (forwarded) forwarded.current = node;
		},
		[own, forwarded],
	);
}

/**
 * The tabs' tray, with a raised card under the selected tab that glides to the next one picked; it jumps when the tray
 * resizes, and always under reduced motion.
 */
export const SegmentedTabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, children, ...props }, ref) => {
	const tray = useRef<HTMLDivElement | null>(null);
	const card = useRef<HTMLSpanElement>(null);
	const setTray = useMergedRef(tray, ref);

	useLayoutEffect(() => {
		const list = tray.current;
		const pill = card.current;
		if (!list || !pill) return;
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
		const place = (animate: boolean) => {
			// `aria-selected`, not `data-state`: a Tooltip around a tab sets the trigger's `data-state` to its own.
			const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
			pill.hidden = !tab;
			if (!tab) return;
			const box = list.getBoundingClientRect();
			const rect = tab.getBoundingClientRect();
			const left = rect.left - box.left - list.clientLeft + list.scrollLeft;
			const top = rect.top - box.top - list.clientTop + list.scrollTop;
			const before = Number.parseFloat(pill.style.left);
			pill.style.transition = animate && !reduced.matches && left !== before ? glide(left < before ? "left" : "right") : "none";
			pill.style.left = `${left}px`;
			pill.style.right = `${list.clientWidth - left - rect.width}px`;
			pill.style.top = `${top}px`;
			pill.style.bottom = `${list.clientHeight - top - rect.height}px`;
		};
		place(false);
		// A pick glides; a tab added or removed only moves the card.
		const picks = new MutationObserver(records => place(records.some(record => record.type === "attributes")));
		picks.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
		const sizes = new ResizeObserver(() => place(false));
		sizes.observe(list);
		for (const tab of list.querySelectorAll('[role="tab"]')) sizes.observe(tab);
		return () => {
			picks.disconnect();
			sizes.disconnect();
		};
	}, []);

	return (
		<TabsPrimitive.List ref={setTray} className={cn("relative flex w-fit shrink-0 gap-0.5 rounded-lg bg-input/40 p-0.5", className)} {...props}>
			<span
				ref={card}
				aria-hidden
				hidden
				className="pointer-events-none absolute rounded-md bg-background shadow-surface-2 dark:bg-input/72"
			/>
			{children}
		</TabsPrimitive.List>
	);
});

export const SegmentedTab = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.Trigger
			ref={ref}
			className={cn(
				"relative inline-flex h-6 min-w-0 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground aria-selected:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60",
				className,
			)}
			{...props}
		/>
	),
);
