/**
 * Tool call card: one tool call of an agent on a card with a hairline shadow, its icon, its name in mono, a short summary,
 * and its status, a spinner while it runs, a check once it finished, or **Failed**. `ToolCallGroup` folds several cards
 * under one quiet line that stacks the last tools' icons on small tiles.
 * After affectUI's Tool Call Card (Clean).
 */
import { IconChevronDownSmall } from "central-icons";
import type { ComponentProps, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/spinner";

export type ToolCallStatus = "running" | "ok" | "error";

/** A tool call's card; `children` sit under its header, such as the images its result returned. */
export function ToolCallCard({ icon: Icon, name, summary, status, children }: { icon: IconComponent; name: string; summary?: string; status: ToolCallStatus; children?: ReactNode }) {
	return (
		<div data-status={status} className="min-w-0 rounded-[10px] bg-card shadow-surface-2">
			<div className="flex min-h-10 items-center gap-2.5 px-3.5">
				<Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<code title={name} className="max-w-[55%] shrink truncate font-mono text-xs font-medium text-foreground">
						{name}
					</code>
					{summary && (
						<span dir="auto" title={summary} className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
							{summary}
						</span>
					)}
				</span>
				<ToolCallStatusMark status={status} />
			</div>
			{children && <div className="border-t border-border px-3.5 py-3">{children}</div>}
		</div>
	);
}

function ToolCallStatusMark({ status }: { status: ToolCallStatus }) {
	if (status === "running") {
		return (
			<span role="img" aria-label="Running" className="flex shrink-0 text-primary">
				<Spinner className="size-3.5" />
			</span>
		);
	}
	if (status === "ok") {
		return (
			<svg role="img" aria-label="Finished" viewBox="0 0 16 16" className="size-3.5 shrink-0">
				<circle cx="8" cy="8" r="7" className="fill-primary" />
				<path d="M5.1 8.2 7.1 10.1 10.9 6" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground" />
			</svg>
		);
	}
	return (
		<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
			<svg aria-hidden viewBox="0 0 16 16" className="size-3.5">
				<circle cx="8" cy="8" r="7" className="fill-destructive" />
				<path d="M8 4.9v3.5M8 10.9v.1" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-white" />
			</svg>
			Failed
		</span>
	);
}

/**
 * Cards folded under one line: the last tools' `icons` stacked on tiles, `title`, which shimmers while `running`, and the
 * count of failed calls. The rest of the props go to the line's button.
 */
export function ToolCallGroup({
	icons,
	title,
	failed,
	running,
	open,
	onOpenChange,
	children,
	...trigger
}: Omit<ComponentProps<typeof CollapsibleTrigger>, "children" | "className" | "title"> & {
	icons: IconComponent[];
	title: string;
	failed: number;
	running: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Collapsible open={open} onOpenChange={onOpenChange} data-running={running || undefined} className="flex w-full max-w-2xl min-w-0 flex-col self-start">
			<CollapsibleTrigger
				{...trigger}
				className="group/tool-group -ml-1.5 flex min-h-8 w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg py-1 pr-2.5 pl-1.5 text-left text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span aria-hidden className="flex shrink-0 p-px">
					{icons.map((Icon, index) => (
						// The stack only ever grows at its end, so a tile's place names it.
						<span key={index} className="grid size-[22px] place-items-center rounded-md bg-card text-muted-foreground shadow-surface-2 not-first:-ml-1">
							<Icon className="size-3" />
						</span>
					))}
				</span>
				<span className="flex min-w-0 items-baseline gap-1.5 text-[13px] whitespace-nowrap">
					<span className={cn("min-w-0 truncate font-medium", running && "text-muted-foreground shimmer motion-reduce:shimmer-none")}>{title}</span>
					{failed > 0 && <span className="shrink-0 text-destructive">{`· ${failed} failed`}</span>}
				</span>
				<IconChevronDownSmall aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/tool-group:rotate-180 motion-reduce:transition-none" />
			</CollapsibleTrigger>
			<CollapsibleContent className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
				<div className="grid gap-1.5 px-px pt-1.5 pb-1">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
