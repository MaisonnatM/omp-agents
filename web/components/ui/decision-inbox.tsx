/** `DecisionInbox`, after affectUI's decision inbox: one card whose head counts what waits on you, over hairline-divided rows. */
import { IconCircleCheck, IconExclamationCircle } from "central-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DecisionInboxProps {
	/** What the head says, such as how many wait. */
	title: string;
	/** Rows wait on you: an amber glyph; none do: a green check. */
	waiting: boolean;
	/** The rows, each an `li`; none leaves the head alone. */
	children?: ReactNode;
	className?: string;
}

export function DecisionInbox({ title, waiting, children, className }: DecisionInboxProps) {
	const Glyph = waiting ? IconExclamationCircle : IconCircleCheck;
	return (
		<section aria-label={title} className={cn("overflow-hidden rounded-[10px] bg-card shadow-surface-2", className)}>
			<h3 className="flex h-11 items-center gap-2 px-4 text-[13px] font-medium text-foreground">
				<Glyph aria-hidden className={cn("size-4 shrink-0", waiting ? "text-warning" : "text-success")} />
				{title}
			</h3>
			{children && <ul className="flex flex-col divide-y divide-border border-t border-border">{children}</ul>}
		</section>
	);
}
