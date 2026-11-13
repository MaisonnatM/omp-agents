/** `ClosableTab`, the shell the header's tabs and the details sidebar's tabs share, and `useTabRowEdges`, which fades the ends of a row of them that scrolls. */
import { IconCrossMedium } from "central-icons";
import { type ComponentProps, type CSSProperties, type ReactNode, type RefObject, useEffect, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";

/** The label fades under the × where it shows. */
const LABEL_FADE = "revealed:[mask-image:linear-gradient(to_left,transparent_1.625rem,black_2rem)]";

interface ClosableTabProps extends Omit<ComponentProps<"div">, "children"> {
	/** The tab's name, which the × says it closes. */
	name: string;
	active: boolean;
	/** `null` for a tab that stays open, which draws no ×. */
	onClose: (() => void) | null;
	/** The Activity control a click on the × records. */
	closeControl: ControlId;
	/** The room the tab on screen keeps at its end for the always-shown × and anything beside it, such as `pr-7`. */
	activePadding: string;
	/** The tab's clickable body, a link or a tab trigger, given the classes that lay it out, focus it, and fade its label under the ×. */
	children: (bodyClassName: string) => ReactNode;
}

/**
 * One closable tab: its body, then an × that an inactive tab shows on hover, on focus, and on a touch screen, and the tab on
 * screen always shows. A middle-click also closes it. Focus rings draw inside, so a row that scrolls does not clip them.
 */
export function ClosableTab({ name, active, onClose, closeControl, activePadding, className, children, ...frame }: ClosableTabProps) {
	return (
		<div
			{...frame}
			className={cn("group/reveal relative flex h-7 items-center rounded-lg text-[13px]", !active && "text-muted-foreground hover:bg-hover hover:text-foreground", className)}
			onMouseDown={event => {
				// A middle press would start the browser's autoscroll before the click that closes the tab.
				if (event.button === 1) event.preventDefault();
			}}
			onAuxClick={event => {
				if (event.button !== 1 || onClose === null) return;
				event.preventDefault();
				onClose();
			}}
		>
			{children(
				cn(
					"flex h-full min-w-0 items-center gap-1.5 rounded-lg pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
					onClose === null ? "pr-2.5" : active ? activePadding : cn("pr-2.5", LABEL_FADE),
				),
			)}
			{onClose !== null && (
				<button
					type="button"
					{...activityControl(closeControl)}
					aria-label={`Close ${name}`}
					className={cn(
						"group/close absolute right-0.5 grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
						!active && "opacity-0 revealed:opacity-100",
					)}
					onClick={onClose}
				>
					<span className="grid size-4 place-items-center rounded-md group-hover/close:bg-active">
						<IconCrossMedium className="size-3" />
					</span>
				</button>
			)}
		</div>
	);
}

/**
 * The fade at each end of the row `list` that hides tabs past it, so the row says it scrolls: the row's `style` and its
 * `onScroll`. `tabs` changes when the row's tabs do; a resize of the row or of a tab measures it again.
 */
export function useTabRowEdges(list: RefObject<HTMLElement | null>, tabs: unknown): { style: CSSProperties; onScroll: () => void } {
	const [edges, setEdges] = useState({ start: false, end: false });
	const measure = (): void => {
		const element = list.current;
		if (!element) return;
		const start = element.scrollLeft > 0;
		const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
		setEdges(shown => (shown.start === start && shown.end === end ? shown : { start, end }));
	};
	// The row's width, and its tabs', which a resize of the window or a tab's new name changes without a scroll.
	useEffect(() => {
		const element = list.current;
		if (!element) return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		for (const tab of element.children) observer.observe(tab);
		return () => observer.disconnect();
	}, [tabs]);
	return {
		style: { maskImage: `linear-gradient(to right, ${edges.start ? "transparent, black 2rem" : "black"}, ${edges.end ? "black calc(100% - 2rem), transparent" : "black"})` },
		onScroll: measure,
	};
}
