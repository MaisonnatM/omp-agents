/** `OverviewSection`, the folding section each part of the right sidebar's **Overview** tab sits in. */
import { IconChevronBottom } from "central-icons";
import type { ReactNode } from "react";
import type { ControlId } from "../../src/shared/activity";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";

interface OverviewSectionProps {
	title: string;
	/** How many items the section lists, after its title. */
	count: number;
	/** Shown after the count, such as the files' added and removed lines. */
	detail?: ReactNode;
	open: boolean;
	onToggle: () => void;
	/** The Activity control a click on the folding header records. */
	fold: ControlId;
	/** A control at the right of the header, outside the button that folds the section. */
	action?: ReactNode;
	children: ReactNode;
}

/** A filled folding header, its title then its count, with an optional action at its right, over the section's body. */
export function OverviewSection({ title, count, detail, open, onToggle, fold, action, children }: OverviewSectionProps) {
	return (
		<Collapsible open={open} onOpenChange={onToggle}>
			<div className="flex h-9 items-center rounded-lg bg-muted">
				<h3 className="flex h-full min-w-0 flex-1">
					<CollapsibleTrigger
						{...activityControl(fold)}
						className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 text-left text-[13px] font-medium text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					>
						<span className="truncate">{title}</span>
						<span className="shrink-0 font-normal text-muted-foreground tabular-nums">{count}</span>
						{detail}
						<IconChevronBottom aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
					</CollapsibleTrigger>
				</h3>
				{action}
			</div>
			<CollapsibleContent keepMounted className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
