/** Summary's collapsible sections, whose headings stay pinned to the top of the details' scroller. */
import { ChevronRight } from "lucide-react";
import { createContext, type ReactNode, useContext, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { sectionCollapseAnchorScrollTop } from "./section.logic";

/** The details' vertical scroller, which a collapsing section scrolls to keep its heading in place. */
export const DetailsScrollerContext = createContext<HTMLElement | null>(null);

export function SummarySection({ title, defaultOpen = true, actions, children }: { title: string; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode }) {
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();
	const scroller = useContext(DetailsScrollerContext);
	const section = useRef<HTMLElement>(null);
	const heading = useRef<HTMLDivElement>(null);
	const toggle = (): void => {
		if (open && scroller && section.current && heading.current) {
			const top = sectionCollapseAnchorScrollTop({
				scrollTop: scroller.scrollTop,
				viewportTop: scroller.getBoundingClientRect().top,
				sectionTop: section.current.getBoundingClientRect().top,
				headingTop: heading.current.getBoundingClientRect().top,
			});
			// Set before React commits the collapse, so the heading pressed never jumps for a frame.
			if (top !== null) scroller.scrollTop = top;
		}
		setOpen(!open);
	};
	return (
		<section ref={section} aria-label={title}>
			<div ref={heading} className="sticky top-0 z-10 flex w-full items-center bg-background pr-4">
				<button type="button" aria-expanded={open} aria-controls={id} onClick={toggle} className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-ring">
					{title}<ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground/60 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				</button>
				{actions}
			</div>
			<div id={id} hidden={!open} className="px-4 pb-4">{children}</div>
		</section>
	);
}
