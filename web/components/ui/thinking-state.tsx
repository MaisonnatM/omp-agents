/**
 * Thinking state: the model's thinking as a quiet header, a 3×3 pixel mark that ripples while it streams and
 * **Thinking** or **Thought**, over its text as one step on a hairline trail; the header folds the trail.
 * After affectUI's Thinking State (Clean).
 */
import { IconChevronDownSmall } from "central-icons";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** The mark's pixels ripple from its top-left corner. */
const PIXEL_DELAYS = [0, 1, 2, 1, 2, 3, 2, 3, 4].map(step => step * 120);

export function ThinkingState({ streaming, children }: { streaming: boolean; children: ReactNode }) {
	return (
		<Collapsible defaultOpen data-streaming={streaming || undefined} className="flex min-w-0 flex-col">
			<CollapsibleTrigger className="group/thinking flex h-9 w-fit max-w-full cursor-pointer items-center gap-2.5 rounded-lg px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<span aria-hidden className="grid size-4 shrink-0 auto-rows-[3px] grid-cols-[repeat(3,3px)] place-content-center gap-[1.5px]">
					{PIXEL_DELAYS.map((delay, index) => (
						<i
							key={index}
							className={cn("rounded-[0.75px] bg-primary", streaming && "motion-safe:animate-[bot-pulse_1.2s_ease-in-out_infinite]")}
							style={streaming ? { animationDelay: `${delay}ms` } : undefined}
						/>
					))}
				</span>
				<span className="truncate text-[13px] font-medium text-foreground transition-colors group-hover/thinking:text-muted-foreground">
					{streaming ? <span className="text-muted-foreground shimmer motion-reduce:shimmer-none">Thinking</span> : "Thought"}
				</span>
				<IconChevronDownSmall
					aria-hidden
					className="-ml-1 size-4 shrink-0 -rotate-90 text-muted-foreground opacity-0 transition group-hover/thinking:opacity-60 group-focus-visible/thinking:opacity-60 group-aria-expanded/thinking:rotate-0 motion-reduce:transition-none"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-300 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
				<div className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 px-3.5 pt-1 pb-2">
					<span aria-hidden className="grid h-5 place-items-center">
						<span className={streaming ? "size-1.5 rounded-[1.5px] bg-primary motion-safe:animate-[bot-pulse_1s_ease-in-out_infinite]" : "size-[5px] rounded-full bg-muted-foreground/45"} />
					</span>
					<span aria-hidden className="absolute top-[26px] bottom-2 left-[21.5px] w-px bg-border" />
					<div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">{children}</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
